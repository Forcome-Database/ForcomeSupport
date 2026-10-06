import { syncedAtWords, type Team, type TeamMember } from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import { EditConflictAlert, OverwriteDialog } from '@/components/edit-conflict';
import { useFocusField } from '@/components/form-field';
import { LoadError } from '@/components/load-error';
import { SaveBar } from '@/components/save-bar';
import { SectionLabel } from '@/components/section-label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnsavedChangesDialog } from '@/components/unsaved-changes-dialog';
import { api, ApiRequestError, NetworkError } from '@/lib/api';
import { formatClock } from '@/lib/channel';
import { useCurrentMember } from '@/lib/current-member';
import { dismissToast, showError, showNeutral, showSuccess, showWarning } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { teamQuery } from '@/lib/team';
import {
  A11Y,
  CONFLICT,
  LEAVE,
  MEMBER_SECTION,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  SAVE_BAR,
  SAVE_RESULT,
  TABS,
} from './p20-copy';
import { PermissionMatrix } from './permission-matrix';
import { SettingsHeader, SettingsLayout } from './settings-layout';
import {
  applyEdit,
  cellErrorsOf,
  changedCellCount,
  changeLines,
  conflictsOf,
  editsAfterReload,
  editsAfterSave,
  firstErrorCell,
  teamChangesOf,
  type TeamCell,
  type TeamCellErrors,
  type TeamConflict,
  type TeamEdits,
} from './team-edits';
import { TeamMemberDrawer } from './team-member-drawer';
import { TeamTable } from './team-table';

/*
 * P20 设置 · 团队与权限（第一阶段，PRD P20「第一阶段」、K6、K17、G7、G8；参照图 design/spec/shots/phase1/P20_SettingsTeam.png）：
 * 页头（不显示备用审批人）、页签「成员 N · 角色权限」；「成员」为成员表（第一阶段没有「语言」列）与「从钉钉添加」抽屉，
 * 「角色权限」为只读的权限矩阵（K17，由 contracts 的能力矩阵渲染）。角色与数据范围在格子里改，改过的留在页面上，
 * 由吸底保存栏统一保存（K6）：成功浮层写修改摘要；断网时保留修改、恢复后自动重试；有人已被别人改过时整批不保存，
 * 表格上方给 G7 横幅（查看最新 / 覆盖保存）；有未保存的修改时离开本页先确认（G8），切页签不算离开。
 * 地址栏带了成员 ID（从 P27 点成员进来）时选中该行。
 */

/** P20 地址栏：member 为要选中的成员（P27 点进详情，PRD P27 v2.20）；写错的丢掉 */
export const teamSearchSchema = z.object({ member: z.uuid().optional().catch(undefined) });

const SAVE_TOAST = 'team-save';
const OFFLINE_TOAST = 'team-save-offline';
const NO_ERRORS: TeamCellErrors = new Map();

type Tab = 'members' | 'permissions';

export function TeamPage() {
  const me = useCurrentMember();
  const queryClient = useQueryClient();
  const team = useQuery(teamQuery);
  const search = teamSearchSchema.parse(useSearch({ strict: false }));
  const ids = useId();
  const cellId = (memberId: string, cell: TeamCell) => `${ids}-${memberId}-${cell}`;
  const [tab, setTab] = useState<Tab>('members');
  const [edits, setEdits] = useState<TeamEdits>(new Map());
  const [errors, setErrors] = useState(NO_ERRORS);
  const [conflicts, setConflicts] = useState<TeamConflict[] | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [adding, setAdding] = useState(false);
  /** 断网时等网络恢复后自动重试（K6） */
  const [waitingOnline, setWaitingOnline] = useState(false);
  const focusField = useFocusField();
  // 断网时要立即失败（交给 K6 的断网处理），不能像 TanStack Query 默认的那样暂停到恢复联网
  const save = useMutation({ mutationFn: api.saveTeam, networkMode: 'always' });
  /**
   * 重试（失败浮层的「立即重试」、断网恢复后的自动重试）提交的是重试那一刻页面上的修改，不是失败那一刻的；
   * 「覆盖保存」后冲突的人改用最新的版本号，之后的重试沿用，保存成功、放弃或查看最新后清掉
   */
  const editsRef = useRef(edits);
  const versionsRef = useRef<ReadonlyMap<string, number> | undefined>(undefined);
  useLayoutEffect(() => {
    editsRef.current = edits;
  });

  const storeNames = useMemo(
    () => new Map((team.data?.stores ?? []).map((s) => [s.id, s.name])),
    [team.data],
  );
  const dirtyCount = changedCellCount(edits);
  const summary = changeLines(edits, storeNames).join(SAVE_BAR.separator);

  // G8：有未保存的修改时离开本页（设置菜单、顶栏导航、头像菜单）先确认；页签与地址栏参数的变化不算离开
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirtyCount > 0 && current.pathname !== next.pathname,
    enableBeforeUnload: dirtyCount > 0,
    withResolver: true,
  });
  /** 「保存并离开」：保存成功后再放行 */
  const leaveAfterSave = useRef(false);

  function finishLeaving(succeeded: boolean) {
    if (!leaveAfterSave.current) return;
    leaveAfterSave.current = false;
    if (blocker.status !== 'blocked') return;
    if (succeeded) blocker.proceed();
    else blocker.reset();
  }

  /** 换一份待保存的修改（同时更新给重试用的那份，setState 要到下一次渲染才生效） */
  function replaceEdits(next: TeamEdits) {
    editsRef.current = next;
    setEdits(next);
  }

  /** 保存成功：提交出去的修改清掉（提交期间又改的留着），成功浮层写摘要；断网后自动重试成功的是中性浮层（K6） */
  function saved(latest: Team, sent: TeamEdits, lines: string, retried: boolean) {
    queryClient.setQueryData(teamQuery.queryKey, latest);
    replaceEdits(editsAfterSave(editsRef.current, sent, latest.members));
    versionsRef.current = undefined;
    setErrors(NO_ERRORS);
    setConflicts(null);
    setWaitingOnline(false);
    dismissToast(SAVE_TOAST);
    dismissToast(OFFLINE_TOAST);
    const at = formatClock(latest.now);
    if (retried) {
      showNeutral({
        title: SAVE_RESULT.retriedTitle,
        description: SAVE_RESULT.retriedDescription(at, lines),
      });
    } else {
      showSuccess({
        title: SAVE_RESULT.savedTitle,
        description: SAVE_RESULT.savedDescription(lines, me.name, at),
      });
    }
    finishLeaving(true);
  }

  /** 保存冲突（409）：取最新的成员表，标出谁、几点改了谁的哪些列（G7）；对不出是谁（期间又改回来了）时按失败处理 */
  async function showConflicts(error: unknown) {
    const latest = await queryClient.fetchQuery({ ...teamQuery, staleTime: 0 });
    const found = conflictsOf(editsRef.current, latest.members);
    if (found.length > 0) {
      setConflicts(found);
      return;
    }
    showError({
      id: SAVE_TOAST,
      action: SAVE_RESULT.failedAction,
      error,
      description: SAVE_RESULT.failedDescription,
      retry: () => saveOnce(false),
    });
  }

  /** 保存失败的处理：会话结束、字段错误、冲突、断网在页面上处理，返回 true；其余交给失败浮层 */
  function handledOnPage(error: unknown): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (error instanceof NetworkError && !navigator.onLine) {
      showWarning({
        id: OFFLINE_TOAST,
        title: SAVE_RESULT.offlineTitle,
        description: SAVE_RESULT.offlineDescription,
        pending: SAVE_RESULT.waiting,
      });
      setWaitingOnline(true);
      return true;
    }
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status === 400 && error.fields) {
      const next = cellErrorsOf(error.fields);
      setErrors(next);
      const first = firstErrorCell(next, team.data?.members.map((m) => m.id) ?? []);
      if (first) focusField(cellId(first.memberId, first.column));
      return true;
    }
    if (error.status === 409) {
      void showConflicts(error);
      return true;
    }
    return false;
  }

  /** 保存一次（提交此刻页面上的修改）：成功收尾；页面上处理不了的失败抛出（给失败浮层的「立即重试」用） */
  async function saveOnce(retried: boolean) {
    const sent = editsRef.current;
    if (sent.size === 0) return;
    const lines = changeLines(sent, storeNames).join(SAVE_BAR.separator);
    try {
      saved(await save.mutateAsync(teamChangesOf(sent, versionsRef.current)), sent, lines, retried);
    } catch (error) {
      if (handledOnPage(error)) {
        finishLeaving(false);
        return;
      }
      throw error;
    }
  }

  async function submit(retried = false) {
    try {
      await saveOnce(retried);
    } catch (error) {
      finishLeaving(false);
      dismissToast(OFFLINE_TOAST);
      showError({
        id: SAVE_TOAST,
        action: SAVE_RESULT.failedAction,
        error,
        description: SAVE_RESULT.failedDescription,
        retry: () => saveOnce(false),
      });
    }
  }

  // 断网后等网络恢复，自动重试一次（K6：成功为中性浮层「已自动重试并保存」，仍失败转红色失败浮层并保留修改）
  const retryWhenOnline = useEffectEvent(() => {
    setWaitingOnline(false);
    void submit(true);
  });
  useEffect(() => {
    if (!waitingOnline) return;
    const online = () => retryWhenOnline();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [waitingOnline]);

  function edit(member: TeamMember, change: Parameters<typeof applyEdit>[2]) {
    replaceEdits(applyEdit(editsRef.current, member, change));
    // 改了哪一格就撤掉它的报错
    setErrors((current) => {
      if (!current.has(member.id)) return current;
      const next = new Map(current);
      const cell = { ...next.get(member.id) };
      if (change.roles) delete cell.roles;
      if (change.stores) delete cell.stores;
      if (cell.roles || cell.stores) next.set(member.id, cell);
      else next.delete(member.id);
      return next;
    });
  }

  function discard() {
    replaceEdits(new Map());
    versionsRef.current = undefined;
    setErrors(NO_ERRORS);
    setConflicts(null);
    setWaitingOnline(false);
    dismissToast(SAVE_TOAST);
    dismissToast(OFFLINE_TOAST);
  }

  /** 「覆盖保存」：冲突的人改用最新的版本号；已不在成员表里的人（例如刚回到通讯录、角色被清空）放弃修改，一个都不剩就不提交 */
  function overwrite() {
    setConfirmOverwrite(false);
    if (!conflicts) return;
    const versions = new Map(versionsRef.current);
    const kept = new Map(editsRef.current);
    for (const conflict of conflicts) {
      if (conflict.latest) versions.set(conflict.id, conflict.latest.version);
      else kept.delete(conflict.id);
    }
    replaceEdits(kept);
    versionsRef.current = versions;
    setConflicts(null);
    if (kept.size > 0) void submit();
  }

  const single = conflicts?.length === 1 ? conflicts[0] : undefined;
  const conflictInfo = conflicts && {
    who: single?.who ?? CONFLICT.someone,
    at: single?.at ? formatClock(single.at) : null,
    fields: single?.fields ?? [],
  };

  const data = team.data;
  return (
    <SettingsLayout
      footer={
        <SaveBar
          copy={SAVE_BAR}
          label={A11Y.saveBar}
          dirtyCount={dirtyCount}
          summary={summary}
          saving={save.isPending || waitingOnline}
          onDiscard={discard}
          onSave={() => void submit()}
        />
      }
    >
      <SettingsHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="members">
            {TABS.members}
            {data && <TabsCount>{data.members.length}</TabsCount>}
          </TabsTrigger>
          <TabsTrigger value="permissions">{TABS.permissions}</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="flex flex-col gap-2.5">
          <section aria-label={A11Y.membersRegion} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <SectionLabel>{MEMBER_SECTION.label}</SectionLabel>
                {data && (
                  <span className="text-12 whitespace-nowrap text-muted-foreground">
                    {MEMBER_SECTION.count(
                      data.members.length,
                      syncedAtWords(data.syncedAt, new Date(data.now)),
                    )}
                  </span>
                )}
              </div>
              <Button size="sm" onClick={() => setAdding(true)} disabled={!data}>
                <Plus />
                {MEMBER_SECTION.add}
              </Button>
            </div>
            {conflicts && conflictInfo && (
              <EditConflictAlert
                conflict={conflictInfo}
                copy={{
                  title: CONFLICT.title(
                    conflicts.map((c) => c.name),
                    single?.who ?? null,
                    conflictInfo.at,
                  ),
                  description: CONFLICT.description(single?.who ?? null, single?.fields ?? []),
                }}
                onReload={() => {
                  const latest = queryClient.getQueryData(teamQuery.queryKey);
                  if (latest) replaceEdits(editsAfterReload(editsRef.current, latest.members));
                  versionsRef.current = undefined;
                  setErrors(NO_ERRORS);
                  setConflicts(null);
                }}
                onOverwrite={() => setConfirmOverwrite(true)}
              />
            )}
            {team.isError ? (
              <LoadError onRetry={() => void team.refetch()} />
            ) : (
              <TeamTable
                members={data?.members ?? null}
                selectedId={search.member}
                selfId={me.id}
                now={new Date(data?.now ?? 0)}
                stores={data?.stores ?? []}
                storeNames={storeNames}
                edits={edits}
                errors={errors}
                cellId={cellId}
                onRoles={(member, roles) => edit(member, { roles })}
                onStores={(member, stores) => edit(member, { stores })}
              />
            )}
          </section>
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionMatrix />
        </TabsContent>
      </Tabs>

      <TeamMemberDrawer
        open={adding}
        stores={data?.stores ?? []}
        onClose={() => setAdding(false)}
      />

      <OverwriteDialog
        conflict={conflictInfo}
        open={confirmOverwrite}
        onOpenChange={setConfirmOverwrite}
        pending={save.isPending}
        onConfirm={overwrite}
      />

      <UnsavedChangesDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset();
        }}
        description={LEAVE.page(dirtyCount)}
        onDiscard={() => {
          discard();
          if (blocker.status === 'blocked') blocker.proceed();
        }}
        onSaveAndLeave={() => {
          leaveAfterSave.current = true;
          void submit();
        }}
      />
    </SettingsLayout>
  );
}

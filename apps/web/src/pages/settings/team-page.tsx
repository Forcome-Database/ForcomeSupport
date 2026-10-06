import { syncedAtWords, type Team, type TeamMember } from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
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
  firstErrorCell,
  teamChangesOf,
  type TeamCell,
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
const NO_ERRORS: ReadonlyMap<string, Partial<Record<TeamCell, string>>> = new Map();

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
  /** 断网时那次保存用的版本号（覆盖保存时是最新的），恢复后自动重试沿用 */
  const retryVersions = useRef<ReadonlyMap<string, number> | undefined>(undefined);

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

  function saved(latest: Team, lines: string, retried: boolean) {
    queryClient.setQueryData(teamQuery.queryKey, latest);
    setEdits(new Map());
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

  /** 保存冲突（409）：取最新的成员表，标出谁、几点改了谁的哪些列（G7） */
  async function showConflicts() {
    const latest = await queryClient.fetchQuery({ ...teamQuery, staleTime: 0 });
    const found = conflictsOf(edits, latest.members);
    if (found.length === 0) {
      // 冲突的那一版已被刷新到页面上（期间又改回来了）：按最新的版本号重新保存即可
      setConflicts(null);
      return;
    }
    setConflicts(found);
  }

  /** 保存失败的处理：会话结束、字段错误、冲突、断网在页面上处理，返回 true；其余交给失败浮层 */
  function handledOnPage(error: unknown, versions?: ReadonlyMap<string, number>): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (error instanceof NetworkError && !navigator.onLine) {
      showWarning({
        id: OFFLINE_TOAST,
        title: SAVE_RESULT.offlineTitle,
        description: SAVE_RESULT.offlineDescription,
        pending: SAVE_RESULT.waiting,
      });
      retryVersions.current = versions;
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
      void showConflicts();
      return true;
    }
    return false;
  }

  /** 保存一次：成功收尾；页面上处理不了的失败抛出（给失败浮层的「立即重试」用） */
  async function saveOnce(
    current: TeamEdits,
    versions: ReadonlyMap<string, number> | undefined,
    retried: boolean,
  ) {
    const lines = changeLines(current, storeNames).join(SAVE_BAR.separator);
    try {
      saved(await save.mutateAsync(teamChangesOf(current, versions)), lines, retried);
    } catch (error) {
      if (handledOnPage(error, versions)) {
        finishLeaving(false);
        return;
      }
      throw error;
    }
  }

  async function submit(versions?: ReadonlyMap<string, number>, retried = false) {
    try {
      await saveOnce(edits, versions, retried);
    } catch (error) {
      finishLeaving(false);
      dismissToast(OFFLINE_TOAST);
      showError({
        id: SAVE_TOAST,
        action: SAVE_RESULT.failedAction,
        error,
        description: SAVE_RESULT.failedDescription,
        retry: () => saveOnce(edits, versions, false),
      });
    }
  }

  // 断网后等网络恢复，自动重试一次（K6：成功为中性浮层「已自动重试并保存」，仍失败转红色失败浮层并保留修改）；
  // 重试的是那时页面上的修改（effect event 取最新的 submit）
  const retryWhenOnline = useEffectEvent(() => {
    setWaitingOnline(false);
    void submit(retryVersions.current, true);
  });
  useEffect(() => {
    if (!waitingOnline) return;
    const online = () => retryWhenOnline();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [waitingOnline]);

  function edit(member: TeamMember, change: Parameters<typeof applyEdit>[2]) {
    setEdits((current) => applyEdit(current, member, change));
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
    setEdits(new Map());
    setErrors(NO_ERRORS);
    setConflicts(null);
    setWaitingOnline(false);
    dismissToast(OFFLINE_TOAST);
  }

  const single = conflicts?.length === 1 ? conflicts[0] : undefined;
  const conflictInfo = conflicts && {
    who: single?.who ?? CONFLICT.someone,
    at: single?.at ? formatClock(single.at) : '',
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
                    conflictInfo.at || null,
                  ),
                  description: CONFLICT.description(single?.who ?? null, single?.fields ?? []),
                }}
                onReload={() => {
                  const latest = queryClient.getQueryData(teamQuery.queryKey);
                  if (latest) setEdits(editsAfterReload(edits, latest.members));
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
        onConfirm={() => {
          setConfirmOverwrite(false);
          if (!conflicts) return;
          // 用最新的版本号覆盖；已不在成员表里的人（例如刚被停用、角色被清空）放弃修改
          const versions = new Map<string, number>();
          let kept = edits;
          for (const conflict of conflicts) {
            if (conflict.latest) versions.set(conflict.id, conflict.latest.version);
            else {
              const next = new Map(kept);
              next.delete(conflict.id);
              kept = next;
            }
          }
          setEdits(kept);
          setConflicts(null);
          void submitWith(kept, versions);
        }}
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

  /** 「覆盖保存」：用调整后的修改与最新的版本号保存（setEdits 还没生效，直接用算好的那份） */
  async function submitWith(current: TeamEdits, versions: ReadonlyMap<string, number>) {
    try {
      await saveOnce(current, versions, false);
    } catch (error) {
      showError({
        id: SAVE_TOAST,
        action: SAVE_RESULT.failedAction,
        error,
        description: SAVE_RESULT.failedDescription,
        retry: () => saveOnce(current, versions, false),
      });
    }
  }
}

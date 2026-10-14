import {
  disableMessages,
  handoverPlan,
  type HandoverAssignment,
  type HandoverGroup,
  type TeamHandover,
  type TeamMember,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Lock } from 'lucide-react';
import { useId, useState } from 'react';
import { AftersalesStatusBadge } from '@/components/aftersales-badges';
import { DisabledReason } from '@/components/disabled-reason';
import { FormField, useFocusField } from '@/components/form-field';
import { LoadError } from '@/components/load-error';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiRequestError } from '@/lib/api';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { teamQuery } from '@/lib/team';
import { DISABLE } from './p20-copy';

/*
 * 停用成员的二次确认（PRD P20「第一阶段」、K10 第一阶段补充小样，协调者 2026-10-14 决定 Q1–Q4；AC-ST-02）：
 * 只检查进行中售后单——区块「进行中售后单 N 张」列出单号与状态，下面一个「接手人」下拉（必要时按店铺各一个，
 * contracts 的 handoverPlan）；没人可接手时下拉置灰、字段下写原因、底部写怎么办、「改派并停用」置灰。
 * 「改派并停用」一次提交：改派与停用同一事务；成功浮层写改派给了谁；成员或他的单刚被别人改过（409）关掉弹窗、成员表刷新。
 */

const DISABLE_TOAST = 'team-disable';

/** 一组接手人的键：全部单一个下拉为 all，按店铺分组为店铺 ID */
const groupKey = (group: HandoverGroup) => group.store?.id ?? 'all';

export function DisableMemberDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const handover = useQuery({
    queryKey: [...teamQuery.queryKey, 'handover', member.id],
    queryFn: () => api.teamHandover(member.id),
    staleTime: 0,
  });

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="w-130">
        <AlertDialogHeader tone="warning" title={DISABLE.title(member.name)} />
        {handover.data ? (
          <HandoverForm handover={handover.data} onClose={onClose} />
        ) : (
          <>
            <AlertDialogBody asChild>
              <div className="flex flex-col gap-3">
                {handover.isError ? (
                  <LoadError onRetry={() => void handover.refetch()} />
                ) : (
                  <>
                    <Skeleton className="h-3.5 w-4/5 rounded-sm" />
                    <Skeleton className="h-24 rounded-md" />
                  </>
                )}
              </div>
            </AlertDialogBody>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Button type="button" variant="outline">
                  {DISABLE.dismiss}
                </Button>
              </AlertDialogCancel>
              <Button type="button" variant="destructive" disabled>
                {DISABLE.confirm}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function HandoverForm({ handover, onClose }: { handover: TeamHandover; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const fieldId = (key: string) => `${ids}-${key}`;
  const focusField = useFocusField();
  const plan = handoverPlan(handover);
  const groups = plan.kind === 'choose' ? plan.groups : [];
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const disable = useMutation({
    mutationFn: (assignments: HandoverAssignment[]) =>
      api.disableTeamMember(handover.member.id, { version: handover.member.version, assignments }),
  });
  const { name } = handover.member;
  const blocked = plan.kind === 'blocked' ? plan : null;

  /** 选好的接手人 → 每张单交给谁 */
  const assignments = (): HandoverAssignment[] =>
    groups.flatMap((group) =>
      group.caseIds.map((caseId) => ({ caseId, ownerId: chosen.get(groupKey(group)) ?? null })),
    );

  /** 停用一次：成功关闭弹窗、成员表换成最新的并提示；失败时抛出 */
  async function disableOnce(): Promise<void> {
    const latest = await disable.mutateAsync(assignments());
    queryClient.setQueryData(teamQuery.queryKey, latest);
    dismissToast(DISABLE_TOAST);
    const owners = [
      ...new Set(
        groups.flatMap((group) => {
          const id = chosen.get(groupKey(group));
          const owner = group.candidates.find((candidate) => candidate.id === id);
          return owner ? [owner.name] : [];
        }),
      ),
    ];
    showSuccess({
      title: DISABLE.doneTitle(name),
      description:
        handover.cases.length > 0
          ? DISABLE.doneReassigned(handover.cases.length, owners)
          : DISABLE.doneNone,
    });
    onClose();
  }

  async function submit() {
    // 没选的组：字段下写「请选择接手人」，焦点到第一个
    const missing = groups.filter((group) => !chosen.get(groupKey(group)));
    if (missing.length > 0) {
      setErrors(new Map(missing.map((group) => [groupKey(group), disableMessages.ownerRequired])));
      focusField(fieldId(groupKey(missing[0]!)));
      return;
    }
    try {
      await disableOnce();
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      if (error instanceof ApiRequestError && error.status === 400 && error.fields?.handover) {
        const first = groups[0];
        if (first) {
          setErrors(new Map([[groupKey(first), error.fields.handover]]));
          focusField(fieldId(groupKey(first)));
          return;
        }
      }
      if (error instanceof ApiRequestError && (error.status === 409 || error.fields?.member)) {
        // 成员或他的单刚被别人改过（或已被停用）：关掉弹窗、成员表刷新，说明已刷新
        onClose();
        await queryClient.invalidateQueries({ queryKey: teamQuery.queryKey });
        showError({
          id: DISABLE_TOAST,
          action: DISABLE.failedAction,
          error,
          description: error.fields?.member ?? DISABLE.stale,
        });
        return;
      }
      showError({ id: DISABLE_TOAST, action: DISABLE.failedAction, error, retry: disableOnce });
    }
  }

  return (
    <>
      <AlertDialogBody asChild>
        <div className="flex flex-col gap-3 text-foreground">
          <p className="text-12 leading-[1.55] text-muted-foreground">{DISABLE.note(name)}</p>
          <div className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-13 font-bold text-foreground">{DISABLE.cases}</span>
              <Badge tone={handover.cases.length > 0 ? 'neutral' : 'muted'}>
                {DISABLE.count(handover.cases.length)}
              </Badge>
            </div>
            {plan.kind === 'none' ? (
              <div className="flex items-center gap-1.5 text-12 text-muted-foreground">
                <CircleCheck className="size-3.5 text-success-text" strokeWidth={2} />
                {DISABLE.noCases}
              </div>
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  {handover.cases.map((item) => (
                    <li key={item.id} className="flex items-center gap-1.5">
                      <span className="text-12 font-semibold text-primary">{item.number}</span>
                      <AftersalesStatusBadge status={item.status} />
                    </li>
                  ))}
                </ul>
                {blocked ? (
                  <FormField
                    label={DISABLE.owner}
                    htmlFor={fieldId('all')}
                    required
                    error={blocked.reason}
                  >
                    <Select disabled>
                      <SelectTrigger
                        id={fieldId('all')}
                        aria-describedby={`${fieldId('all')}-error`}
                      >
                        <SelectValue placeholder={DISABLE.none} />
                      </SelectTrigger>
                    </Select>
                  </FormField>
                ) : (
                  groups.map((group, index) => {
                    const key = groupKey(group);
                    const error = errors.get(key);
                    return (
                      <FormField
                        key={key}
                        label={
                          group.store ? DISABLE.ownerForStore(group.store.name) : DISABLE.owner
                        }
                        htmlFor={fieldId(key)}
                        required
                        hint={index === groups.length - 1 ? DISABLE.hint : undefined}
                        error={error}
                      >
                        <Select
                          value={chosen.get(key) ?? ''}
                          onValueChange={(value) => {
                            if (!value) return;
                            setChosen(new Map(chosen).set(key, value));
                            const next = new Map(errors);
                            next.delete(key);
                            setErrors(next);
                          }}
                        >
                          <SelectTrigger
                            id={fieldId(key)}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? `${fieldId(key)}-error` : undefined}
                          >
                            <SelectValue placeholder={DISABLE.placeholder} />
                          </SelectTrigger>
                          <SelectContent>
                            {group.candidates.map((owner) => (
                              <SelectItem key={owner.id} value={owner.id}>
                                {DISABLE.option(owner.name)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    );
                  })
                )}
              </>
            )}
          </div>
        </div>
      </AlertDialogBody>
      <AlertDialogFooter>
        {blocked && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Lock className="size-3.5 shrink-0 text-subtle-foreground" />
            <span className="truncate text-12 text-muted-foreground" title={blocked.fix}>
              {blocked.fix}
            </span>
          </div>
        )}
        <AlertDialogCancel>
          <Button type="button" variant="outline" autoFocus>
            {DISABLE.dismiss}
          </Button>
        </AlertDialogCancel>
        <DisabledReason reason={blocked?.fix ?? null}>
          <Button
            type="button"
            variant="destructive"
            disabled={blocked !== null}
            loading={disable.isPending}
            onClick={() => void submit()}
          >
            {DISABLE.confirm}
          </Button>
        </DisabledReason>
      </AlertDialogFooter>
    </>
  );
}

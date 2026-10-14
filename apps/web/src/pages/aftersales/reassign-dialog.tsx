import {
  handlingMethodLabels,
  PENDING_OWNER_WORDS,
  reassignCandidates,
  reassignMessages,
  responsibilityLabels,
  type LedgerItem,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { DisabledReason } from '@/components/disabled-reason';
import { FormField, useFocusField } from '@/components/form-field';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AFTERSALES_QUERY_KEY, registrationOptionsQuery } from '@/lib/aftersales';
import { api, ApiRequestError } from '@/lib/api';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { REASSIGN, STALE } from './p13-copy';

/*
 * 改派负责人（PRD P13「第一阶段」、S15 补充小样 · 改派负责人与待分配，协调者 2026-10-14 决定 Q8）：照取消弹窗的样子——
 * 标题「改派 S-…？」、说明「客户 · 处理方式 · 责任」、一行「现在的负责人」（待分配的写原负责人）、「接手人」下拉
 * （有该店铺范围的在职售后负责人，不含现负责人，contracts 的 reassignCandidates；候选来自新建登记的选项接口）。
 * 没有可选的人时下拉置灰、字段下写原因、「改派」置灰。成功浮层写前后负责人；单刚被别人改过（409）关掉弹窗、台账刷新。
 */

const REASSIGN_TOAST = 'aftersales-reassign';

export function ReassignDialog({ item, onClose }: { item: LedgerItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ownerId = `${useId()}-owner`;
  const focusField = useFocusField();
  const options = useQuery(registrationOptionsQuery);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reassign = useMutation({
    mutationFn: (owner: string | null) =>
      api.reassignAftersales(item.number, { version: item.version, ownerId: owner }),
  });
  const candidates = options.data
    ? reassignCandidates(options.data.owners, item.store.id, item.ownerId)
    : null;
  const noOne = candidates !== null && candidates.length === 0;
  const before = item.ownerPending
    ? REASSIGN.pendingOwner(item.ownerName ?? '')
    : (item.ownerName ?? '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });

  /** 改派一次：成功关闭弹窗并提示；失败时抛出 */
  async function reassignOnce(): Promise<void> {
    const done = await reassign.mutateAsync(chosen);
    dismissToast(REASSIGN_TOAST);
    showSuccess({
      title: REASSIGN.doneTitle(done.number),
      description: REASSIGN.doneDescription(
        item.ownerPending ? PENDING_OWNER_WORDS : (item.ownerName ?? ''),
        done.ownerName ?? '',
      ),
    });
    onClose();
    await refresh();
  }

  async function submit() {
    setError(null);
    if (!chosen) {
      setError(reassignMessages.ownerMissing);
      focusField(ownerId);
      return;
    }
    try {
      await reassignOnce();
    } catch (failure) {
      if (endSessionIfUnauthenticated(queryClient, failure)) return;
      if (failure instanceof ApiRequestError && failure.status === 400 && failure.fields?.ownerId) {
        setError(failure.fields.ownerId);
        focusField(ownerId);
        return;
      }
      if (failure instanceof ApiRequestError && failure.status === 409) {
        // 这张单刚被别人改过：关掉弹窗、刷新台账，说明已刷新
        onClose();
        await refresh();
        showError({
          id: REASSIGN_TOAST,
          action: REASSIGN.failedAction,
          error: failure,
          description: STALE,
        });
        return;
      }
      showError({
        id: REASSIGN_TOAST,
        action: REASSIGN.failedAction,
        error: failure,
        retry: reassignOnce,
      });
    }
  }

  const method = item.method ? handlingMethodLabels[item.method] : '';
  const responsibility = item.responsibility ? responsibilityLabels[item.responsibility] : '';
  const shownError = noOne ? reassignMessages.noCandidate : error;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="w-115">
        <AlertDialogHeader
          title={REASSIGN.title(item.number)}
          description={REASSIGN.description(item.customerName ?? '', method, responsibility)}
        />
        <AlertDialogBody asChild>
          <div className="flex flex-col gap-3 text-foreground">
            <div className="flex items-center gap-2">
              <span className="text-12 text-muted-foreground">{REASSIGN.current}</span>
              <span className="text-13 font-semibold text-foreground">{before}</span>
            </div>
            <FormField
              label={REASSIGN.owner}
              htmlFor={ownerId}
              required
              hint={REASSIGN.hint}
              error={shownError ?? undefined}
            >
              {candidates === null ? (
                <Skeleton className="h-8 rounded-md" />
              ) : (
                <Select
                  value={chosen ?? ''}
                  disabled={noOne}
                  onValueChange={(value) => {
                    setChosen(value || null);
                    setError(null);
                  }}
                >
                  <SelectTrigger
                    id={ownerId}
                    // 没有可选的人时是置灰的下拉（原型 select_box 的 disabled），原因只写在字段下方
                    aria-invalid={shownError && !noOne ? true : undefined}
                    aria-describedby={shownError ? `${ownerId}-error` : undefined}
                  >
                    <SelectValue placeholder={noOne ? REASSIGN.none : REASSIGN.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {REASSIGN.option(owner.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </div>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Button type="button" variant="outline" autoFocus>
              {REASSIGN.dismiss}
            </Button>
          </AlertDialogCancel>
          <DisabledReason reason={noOne ? reassignMessages.noCandidate : null}>
            <Button
              type="button"
              disabled={noOne || candidates === null}
              loading={reassign.isPending}
              onClick={() => void submit()}
            >
              {REASSIGN.confirm}
            </Button>
          </DisabledReason>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

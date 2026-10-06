import type { CurrentMember } from '@forcome/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { channelAlertsQuery, formatDayClock } from '@/lib/channel';
import { canOpenPage, pages } from '@/lib/pages';
import { CHANNEL_ALERT_COPY, VIEW_CHANNEL_STATUS } from './channel-alert-copy';

/*
 * 全站横幅（G4 集成中断、K7，待办 09）：某个渠道（钉钉除外）连接异常时，所有页面顶栏下方都显示红色横幅，不可关闭；
 * 每分钟重取一次，恢复后自动消失。「查看渠道状态」进 P18，只对能打开 P18 的人（管理员）显示。
 * 布局照原型 app(banner_html=)：顶栏下方，左右 16、上 12 的留白。
 */
export function ChannelAlertBanner({ member }: { member: CurrentMember }) {
  const alerts = useQuery(channelAlertsQuery);
  const shown = (alerts.data ?? []).map((alert) => ({
    alert,
    copy: CHANNEL_ALERT_COPY[alert.kind],
  }));
  if (shown.length === 0) return null;
  const admin = canOpenPage(member, pages.settingsChannels);
  return (
    <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">
      {shown.map(({ alert, copy }) => (
        <Alert
          key={alert.kind}
          tone="danger"
          title={copy.title}
          description={copy.description(formatDayClock(alert.since))}
          action={
            admin && (
              <Button variant="outline" size="sm" asChild>
                <Link to={pages.settingsChannels.path}>{VIEW_CHANNEL_STATUS}</Link>
              </Button>
            )
          }
        />
      ))}
    </div>
  );
}

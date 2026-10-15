// channel：店铺与邮箱；接入与规范化：收取、去重、店铺与来源识别、订单号抽取（ADR 0005；第一期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export { createDevAcceptanceRoutes, reportAcceptanceJob } from './dev-acceptance';
export { channelSenderRulesFixtureStep, channelStoresFixtureStep } from './fixtures';
export { inboundReceivedJob, outboundSyncedJob } from './events';
export { gmailPollJob, gmailRenewWatchJob, gmailSyncJob } from './gmail-sync';
export { imapPollJob, imapSyncJob } from './imap-sync';
export {
  createChannelFeeds,
  createChannelJobHandlers,
  placeUnassignedJob,
  storeChangedJob,
} from './jobs';
export {
  findInboundMessage,
  findOutboundMessage,
  listMergeableInboundIds,
  listMessageSummaries,
  listReceivedMail,
  listReplyTargets,
  type InboundMessage,
  type MessageSummary,
  type OutboundMessage,
  type ReceivedMail,
  type ReplyTarget,
} from './messages';
export { type MailAddress, type Recognition, type SenderRule } from './recognition';
export { mailboxHealths, mailSyncedThrough, type MailboxHealth } from './mailbox-health';
export { channelSelfCheckProbe } from './self-check';
export {
  mailCutoverStatus,
  readMailCutover,
  type MailCutover,
  type MailCutoverStatus,
} from './mail-cutover';
export {
  beginCutover,
  completeCutover,
  listReplayMail,
  markReplayed,
  nextReplayItems,
  replayMail,
  replayProgress,
  ReplaySessions,
  watchedMailboxes,
  watchMailboxes,
  type ReplayItem,
  type WatchedMailbox,
} from './mail-replay';
export { type MailOutcome } from './gmail-sync';
export { clearInboundMail } from './reset';
export { createChannelRoutes } from './routes';
export { assignStore, listUnassignedMail, placeMatchingMail } from './unassigned';
export { registerSenderRule } from './sender-rules';
export {
  findOrderStore,
  listOrderStores,
  listStoreChoices,
  listStoreOptions,
  storeAccessTarget,
  storeNamesById,
} from './stores';

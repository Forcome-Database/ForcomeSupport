import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/**
 * P20 的查询：添加成员后整组失效（成员表与「从钉钉添加」的候选一起刷新）；吸底栏的保存直接用接口返回的成员表更新缓存
 * （保存不会改变谁是候选：角色不能清空）
 */
export const TEAM_QUERY_KEY = ['team'] as const;

/** P20 成员表 */
export const teamQuery = queryOptions({
  queryKey: [...TEAM_QUERY_KEY, 'members'],
  queryFn: api.team,
});

/** 「从钉钉添加」可选的人 */
export const teamCandidatesQuery = queryOptions({
  queryKey: [...TEAM_QUERY_KEY, 'candidates'],
  queryFn: api.teamCandidates,
});

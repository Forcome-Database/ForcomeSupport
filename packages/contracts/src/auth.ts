import { z } from 'zod';

/**
 * 登录与会话（ADR 0010 及其修订）。第一期角色用原型的中文角色名作快照，
 * 04 号待办定角色枚举与能力矩阵后收紧类型。
 */

/** 当前登录的成员（GET /api/me） */
export const currentMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  roles: z.array(z.string()),
});
export type CurrentMember = z.infer<typeof currentMemberSchema>;

/** 开发登录可选的成员（只在非生产环境、开启开发登录时提供） */
export const devMemberSchema = currentMemberSchema.extend({
  dept: z.string(),
});
export type DevMember = z.infer<typeof devMemberSchema>;

export const devMembersResponseSchema = z.object({ members: z.array(devMemberSchema) });
export type DevMembersResponse = z.infer<typeof devMembersResponseSchema>;

export const devLoginRequestSchema = z.object({ memberId: z.uuid() });
export type DevLoginRequest = z.infer<typeof devLoginRequestSchema>;

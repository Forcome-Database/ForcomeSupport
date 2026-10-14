import { describe, expect, it } from 'vitest';
import { staleImages } from './images.mjs';

describe('旧版本镜像的清理（待办 28）', () => {
  it('只留本次与上一次部署的版本；数据库镜像、没有标签的不动', () => {
    const listed = [
      'forcome-server:aaaaaaaaaaaa',
      'forcome-server:bbbbbbbbbbbb',
      'forcome-server:cccccccccccc-dirty',
      'forcome-web:aaaaaaaaaaaa',
      'forcome-web:cccccccccccc-dirty',
      'forcome-smoke:bbbbbbbbbbbb',
      'forcome-smoke:dddddddddddd',
      'forcome-robot-sink:dddddddddddd',
      'forcome-postgres:18',
      'forcome-server:<none>',
      '',
    ];
    expect(staleImages(listed, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])).toEqual([
      'forcome-robot-sink:dddddddddddd',
      'forcome-server:cccccccccccc-dirty',
      'forcome-smoke:dddddddddddd',
      'forcome-web:cccccccccccc-dirty',
    ]);
  });

  it('第一次部署（没有上一次）：只留本次', () => {
    expect(staleImages(['forcome-server:old', 'forcome-server:new'], ['new', null])).toEqual([
      'forcome-server:old',
    ]);
  });
});

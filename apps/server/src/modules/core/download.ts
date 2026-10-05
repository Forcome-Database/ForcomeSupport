import { EXPORT_ROWS_HEADER, XLSX_CONTENT_TYPE } from '@forcome/contracts';

/**
 * 导出 Excel 的响应头（S11、K5：服务端同步生成后直接下载，不留存文件）：中文文件名放 Content-Disposition 的 filename*
 * （filename 写一个 ASCII 的备用名），行数放 EXPORT_ROWS_HEADER（前端浮层写单数、行数用），不缓存。台账、审计日志、报表共用
 */
export function xlsxDownloadHeaders(
  file: { readonly fileName: string; readonly rows: number },
  fallbackName: string,
): Record<string, string> {
  return {
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    [EXPORT_ROWS_HEADER]: String(file.rows),
    'Cache-Control': 'no-store',
  };
}

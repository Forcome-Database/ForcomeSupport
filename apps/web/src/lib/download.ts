/*
 * 让浏览器保存一个已在内存里的文件（导出 Excel，S11、K5：服务端同步生成后直接下载，不留存文件）：
 * 用对象地址加 a[download] 触发下载，随后释放地址。
 */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // 下载开始后再释放（有的浏览器在点击后才读取地址）
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

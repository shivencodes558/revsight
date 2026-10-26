import html2canvas from 'html2canvas';

// Render a DOM node to PNG and put it on the clipboard as an image, so it can
// be pasted straight into an email draft. Falls back to a file download when
// the browser (or its permissions) won't allow a clipboard image write.
export async function copyChannelImage(node, onStatus) {
  if (!node) return;
  onStatus('copying');
  let blob;
  try {
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not render image');
  } catch (e) {
    console.error('[copy image] render failed', e);
    onStatus('error');
    setTimeout(() => onStatus('idle'), 1800);
    return;
  }
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard image API unavailable');
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
    onStatus('copied');
  } catch (e) {
    console.warn('[copy image] clipboard write failed, falling back to download', e);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `daily-report-${node.dataset.channel || 'report'}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    onStatus('downloaded');
  }
  setTimeout(() => onStatus('idle'), 1800);
}

// Label shown on the copy-image button for a given status.
export const copyImageLabel = status => ({
  copying: 'Copying…', copied: '✓ Copied', downloaded: '↓ Downloaded', error: "Couldn't copy",
}[status] || '⧉ Copy image');

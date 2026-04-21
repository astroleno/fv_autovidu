/**
 * 生成离线可打开的审片 HTML：左侧资产列表、右侧表格 + 视频 + 首尾帧 + 操作/备注 + 导出 CSV。
 * 与 prepare_scene_cut_review.mjs 解耦，便于维护样式与内嵌脚本。
 */

/**
 * @typedef {{ assetName: string, assetDescription?: string }} AssetItem
 * @typedef {{
 *   characters: AssetItem[],
 *   props: AssetItem[],
 *   scenes: AssetItem[],
 *   vfx: AssetItem[],
 * }} AssetManifest
 */

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{
 *   title: string,
 *   segments: Array<Record<string, unknown>>,
 *   assets: AssetManifest,
 * }} opts
 * @returns {string}
 */
export function buildReviewHtml(opts) {
  const payload = {
    title: opts.title,
    generatedAt: new Date().toISOString(),
    segments: opts.segments,
    assets: opts.assets,
  };
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f1115; color: #e8eaed; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
    aside {
      padding: 16px;
      border-right: 1px solid #2a2f3a;
      background: #12151c;
      overflow: auto;
    }
    aside h2 { margin: 0 0 12px; font-size: 14px; color: #9aa0a6; }
    aside section { margin-bottom: 16px; }
    aside ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5; color: #c4c7ce; }
    main { padding: 16px; overflow: auto; }
    h1 { margin: 0 0 12px; font-size: 18px; }
    .toolbar { margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    button {
      background: #1a73e8;
      color: #fff;
      border: 0;
      border-radius: 6px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
    }
    button.secondary { background: #3c4043; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #2a2f3a; padding: 8px; vertical-align: top; }
    th { text-align: left; color: #9aa0a6; font-weight: 600; position: sticky; top: 0; background: #0f1115; z-index: 1; }
    video { max-width: 220px; max-height: 400px; background: #000; border-radius: 6px; }
    img.frame { width: 96px; height: auto; border-radius: 4px; background: #000; object-fit: contain; }
    select, textarea { width: 100%; background: #1e1e1e; color: #e8eaed; border: 1px solid #3c4043; border-radius: 4px; padding: 6px; font-size: 12px; }
    textarea { min-height: 56px; resize: vertical; }
    .mono { font-family: ui-monospace, monospace; font-size: 11px; color: #bdc1c6; }
    .hint { font-size: 12px; color: #9aa0a6; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="layout">
    <aside id="assetPanel"></aside>
    <main>
      <h1>${escapeHtml(opts.title)}</h1>
      <p class="hint">每行可播放片段、查看首尾帧；在「操作」中选择 keep / merge_prev / merge_next / drop；备注可写给人或后续脚本。改完后点「导出 CSV」保存到本地。</p>
      <div class="toolbar">
        <button type="button" id="btnExport">导出 CSV</button>
        <button type="button" id="btnExpand" class="secondary">全部展开视频控件</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>时间轴 (s)</th>
            <th>首帧</th>
            <th>尾帧</th>
            <th>片段</th>
            <th>操作</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody id="segBody"></tbody>
      </table>
    </main>
  </div>
  <script type="application/json" id="review-data">${json}</script>
  <script>
  (function () {
    var el = document.getElementById('review-data');
    var data = JSON.parse(el.textContent || '{}');
    var segments = data.segments || [];
    var assets = data.assets || { characters: [], props: [], scenes: [], vfx: [] };

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderAssets() {
      var panel = document.getElementById('assetPanel');
      var h = '<h2>资产列表（VLM 分段用）</h2>';
      function block(title, items) {
        h += '<section><h2>' + esc(title) + '</h2><ul>';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          h += '<li><strong>' + esc(it.assetName || '') + '</strong></li>';
        }
        h += '</ul></section>';
      }
      block('人物', assets.characters || []);
      block('道具', assets.props || []);
      block('场景', assets.scenes || []);
      if ((assets.vfx || []).length) block('特效', assets.vfx);
      panel.innerHTML = h;
    }

    function rowHtml(seg) {
      var tr = document.createElement('tr');
      tr.dataset.segId = String(seg.seg_id);
      tr.innerHTML =
        '<td class="mono">' + esc(String(seg.seg_id)) + '</td>' +
        '<td class="mono">' +
          esc(seg.start_s) + ' → ' + esc(seg.end_s) + '<br/>' +
          'dur ' + esc(seg.duration_s) + 's' +
        '</td>' +
        '<td><img class="frame" alt="首帧" src="' + esc(seg.first_frame_rel) + '" /></td>' +
        '<td><img class="frame" alt="尾帧" src="' + esc(seg.last_frame_rel) + '" /></td>' +
        '<td><video controls preload="metadata" src="' + esc(seg.video_rel) + '"></video></td>' +
        '<td><select class="actionSel" data-field="action">' +
          '<option value="keep">keep</option>' +
          '<option value="merge_prev">merge_prev</option>' +
          '<option value="merge_next">merge_next</option>' +
          '<option value="drop">drop</option>' +
        '</select></td>' +
        '<td><textarea class="notesTa" data-field="notes" placeholder="备注…"></textarea></td>';
      var sel = tr.querySelector('.actionSel');
      var ta = tr.querySelector('.notesTa');
      if (seg.action) sel.value = seg.action;
      if (seg.notes) ta.value = seg.notes;
      return tr;
    }

    function renderTable() {
      var body = document.getElementById('segBody');
      body.innerHTML = '';
      for (var i = 0; i < segments.length; i++) {
        body.appendChild(rowHtml(segments[i]));
      }
    }

    function collectCsv() {
      var rows = [];
      var body = document.getElementById('segBody');
      var trs = body.querySelectorAll('tr');
      for (var i = 0; i < trs.length; i++) {
        var tr = trs[i];
        var id = tr.dataset.segId;
        var seg = segments.filter(function (s) { return String(s.seg_id) === id; })[0];
        if (!seg) continue;
        var action = tr.querySelector('.actionSel').value;
        var notes = tr.querySelector('.notesTa').value;
        rows.push({
          seg_id: String(seg.seg_id),
          start_s: seg.start_s,
          end_s: seg.end_s,
          duration_s: seg.duration_s,
          video_file: seg.video_file,
          first_frame: seg.first_frame,
          last_frame: seg.last_frame,
          action: action,
          notes: notes.replace(/\\r?\\n/g, ' ')
        });
      }
      var headers = ['seg_id','start_s','end_s','duration_s','video_file','first_frame','last_frame','action','notes'];
      var lines = [headers.join(',')];
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        var line = headers.map(function (h) {
          var v = r[h] != null ? String(r[h]) : '';
          if (/[",\\n\\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
          return v;
        }).join(',');
        lines.push(line);
      }
      return lines.join('\\n') + '\\n';
    }

    document.getElementById('btnExport').addEventListener('click', function () {
      var blob = new Blob([collectCsv()], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cuts_review_edited.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById('btnExpand').addEventListener('click', function () {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        try { vids[i].play(); } catch (e) {}
      }
    });

    renderAssets();
    renderTable();
  })();
  </script>
</body>
</html>
`;
}

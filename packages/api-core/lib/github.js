// =====================================================
//  GitHub Releases helper
//  - GET (público): pega URL do último asset de um release
//  - POST (com GITHUB_TOKEN): cria release e faz upload
// =====================================================

const GH_API = 'https://api.github.com';

export function ghEnabled() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

export function getRepo() {
  return process.env.GITHUB_REPO || '';
}

export async function getLatestAssetUrl(repo = getRepo(), assetPattern) {
  if (!repo) return null;
  const r = await fetch(`${GH_API}/repos/${repo}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json' }
  });
  if (!r.ok) return null;
  const rel = await r.json();
  const assets = rel.assets || [];
  if (!assetPattern) return assets[0]?.browser_download_url || null;
  const match = assets.find(a => a.name.match(assetPattern));
  return match?.browser_download_url || assets[0]?.browser_download_url || null;
}

export async function createRelease({ tag, name, body, files = [] }) {
  if (!ghEnabled()) {
    throw new Error('GITHUB_TOKEN e GITHUB_REPO são necessários para criar release');
  }
  const repo = getRepo();

  // 1. Cria o release
  const r = await fetch(`${GH_API}/repos/${repo}/releases`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tag_name: tag, name, body })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`GitHub releases.create error ${r.status}: ${err}`);
  }
  const rel = await r.json();

  // 2. Faz upload de cada arquivo
  for (const file of files) {
    const upload = await fetch(`${GH_API}/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': file.contentType || 'application/octet-stream'
      },
      body: file.buffer
    });
    if (!upload.ok) {
      const err = await upload.text();
      throw new Error(`GitHub upload error ${upload.status}: ${err}`);
    }
  }

  return rel;
}

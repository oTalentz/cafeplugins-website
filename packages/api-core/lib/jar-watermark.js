import jwt from 'jsonwebtoken';
import AdmZip from 'adm-zip';
import { createLogger } from './logger.js';

const log = createLogger('jar-watermark');

const LICENSE_PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const LICENSE_PUBLIC_KEY = (process.env.LICENSE_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();

function validatePrivateKey() {
  if (!LICENSE_PRIVATE_KEY) {
    throw new Error('LICENSE_PRIVATE_KEY não configurado');
  }
  try {
    jwt.sign({ test: 1 }, LICENSE_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '1s' });
  } catch (e) {
    throw new Error(`LICENSE_PRIVATE_KEY inválida: ${e.message}`);
  }
}

function readEntry(zip, name) {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  return entry.getData().toString('utf-8');
}

function writeEntry(zip, name, content) {
  try { zip.deleteFile(name); } catch {}
  zip.addFile(name, Buffer.from(content, 'utf-8'));
}

/**
 * Baixa o JAR original a partir de uma URL pública (por exemplo, release do GitHub).
 * Reutiliza a lógica de autenticação para repositórios privados.
 */
async function fetchWithHeaders(originalUrl, headers) {
  let res = await fetch(originalUrl, { redirect: 'manual', headers });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    log.info('redirect detectado no JAR original', { status: res.status, location: res.headers.get('location') });
    // Follow redirect WITHOUT auth headers (signed URL already has token in query string)
    res = await fetch(res.headers.get('location'), { redirect: 'follow' });
  }
  return res;
}

export async function fetchOriginalJar(originalUrl) {
  const isGitHubApi = originalUrl.includes('api.github.com') && originalUrl.includes('/releases/assets/');
  const isGitHubWeb = originalUrl.includes('github.com') && originalUrl.includes('/releases/download/');
  const token = process.env.GITHUB_TOKEN;

  // Para repos privados, a browser_download_url (github.com/.../releases/download/...)
  // nao funciona com bearer token — o GitHub retorna 404.
  // A solucao e converter para a API URL (api.github.com/.../releases/assets/{id})
  // que aceita bearer token e redireciona para uma URL assinada.
  if (isGitHubWeb && token) {
    try {
      const match = originalUrl.match(/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
      if (match) {
        const [, repo, tag, filename] = match;
        log.info('convertendo URL web para API', { originalUrl, repo, tag, filename });
        const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cafe-plugins' }
        });
        if (releaseRes.ok) {
          const releaseData = await releaseRes.json();
          const asset = (releaseData.assets || []).find(a => a.name === filename);
          if (asset && asset.url) {
            log.info('asset encontrado via API', { assetId: asset.id, apiUrl: asset.url });
            originalUrl = asset.url;
          }
        }
      }
    } catch (e) {
      log.warn('falha ao converter URL web para API', { error: e.message });
    }
  }

  const attempts = [];
  if (token && (isGitHubApi || isGitHubWeb || originalUrl.includes('api.github.com'))) {
    attempts.push({
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream', 'User-Agent': 'cafe-plugins' },
      withToken: true
    });
  }
  attempts.push({
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'cafe-plugins' },
    withToken: false
  });

  let lastErr = null;
  for (const attempt of attempts) {
    log.info('baixando JAR original', { originalUrl, withToken: attempt.withToken });
    try {
      const res = await fetchWithHeaders(originalUrl, attempt.headers);
      if (!res.ok) {
        throw new Error(`Falha ao baixar JAR original: ${res.status} ${res.statusText}`);
      }

      const jarBuffer = Buffer.from(await res.arrayBuffer());
      if (!jarBuffer.length) {
        throw new Error('JAR original veio vazio');
      }

      // Verifica magic number do ZIP (JAR é um ZIP)
      if (jarBuffer[0] !== 0x50 || jarBuffer[1] !== 0x4B) {
        throw new Error('JAR original não é um arquivo ZIP válido (pode ser HTML de redirect)');
      }

      log.info('JAR original baixado', { originalUrl, withToken: attempt.withToken, size: jarBuffer.length });
      return jarBuffer;
    } catch (err) {
      lastErr = err;
      log.warn('tentativa de download falhou', { originalUrl, withToken: attempt.withToken, error: err.message });
    }
  }

  throw lastErr || new Error('Falha ao baixar JAR original');
}

/**
 * Recebe um buffer de JAR e garante que o `cafe-license.yml` dentro dele
 * contenha a LICENSE_PUBLIC_KEY configurada no backend.
 * Isso permite que o admin envie o JAR bruto e o backend embarque a chave
 * automaticamente, sem precisar rebuildar o plugin Java a cada deploy.
 */
export function embedPublicKeyInJar(jarBuffer, productId, apiUrl = 'https://cafeplugins.com/api') {
  if (!jarBuffer || !jarBuffer.length) {
    throw new Error('JAR vazio');
  }
  if (jarBuffer[0] !== 0x50 || jarBuffer[1] !== 0x4B) {
    throw new Error('Arquivo não é um JAR/ZIP válido');
  }
  if (!LICENSE_PUBLIC_KEY) {
    throw new Error('LICENSE_PUBLIC_KEY não configurada no backend');
  }

  let zip;
  try {
    zip = new AdmZip(jarBuffer);
  } catch (e) {
    throw new Error(`Falha ao ler JAR: ${e.message}`);
  }

  let licenseYaml = readEntry(zip, 'cafe-license.yml') || '';

  // Se o arquivo não existe, cria um novo
  if (!licenseYaml.trim()) {
    licenseYaml = `# Configuração de licenciamento da cafe plugins.\n# Gerado automaticamente no upload.\n`;
  }

  // Atualiza/insere product-id, api-url e public-key
  const lines = licenseYaml.split(/\r?\n/);
  const setKey = (key, value) => {
    const idx = lines.findIndex(l => l.trim().startsWith(`${key}:`));
    const serialized = value.includes('\n') ? ` |\n${value.split('\n').map(l => `  ${l}`).join('\n')}` : ` ${value}`;
    if (idx >= 0) {
      // substitui chave e remove possíveis linhas multilinha antigas
      let end = idx + 1;
      while (end < lines.length && (lines[end].startsWith('  ') || lines[end].startsWith('   '))) end++;
      lines.splice(idx, end - idx, `${key}:${serialized}`);
    } else {
      lines.push(`${key}:${serialized}`);
    }
  };

  setKey('product-id', productId);
  setKey('api-url', apiUrl);
  setKey('public-key', LICENSE_PUBLIC_KEY);

  writeEntry(zip, 'cafe-license.yml', lines.join('\n'));

  let out;
  try {
    out = zip.toBuffer();
  } catch (e) {
    throw new Error(`Falha ao gerar JAR final: ${e.message}`);
  }
  return out;
}

/**
 * Faz upload de um JAR para uma release do GitHub e retorna a URL pública.
 * Requer GITHUB_TOKEN no .env.
 */
export async function uploadJarToGitHubRelease({ buffer, productId, productName, version = 'v1.0.0', filename: customFilename, contentType: customContentType }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN não configurado no .env');
  }
  const repo = process.env.GITHUB_PLUGIN_REPO || 'oTalentz/Bestiary-Plugin-CafePlugins2026';
  const safeName = String(productName || productId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = customFilename || `${safeName}-${version}.jar`;
  const contentType = customContentType || 'application/java-archive';

  // Cria release (ignora 422 se já existir)
  const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: version, name: version, body: `Build ${productId} via painel admin`, draft: false, prerelease: false })
  });
  let release;
  if (releaseRes.status === 422) {
    const existing = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${version}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!existing.ok) throw new Error('Não foi possível criar ou localizar release no GitHub');
    release = await existing.json();
  } else if (!releaseRes.ok) {
    throw new Error(`Erro ao criar release GitHub: ${releaseRes.status}`);
  } else {
    release = await releaseRes.json();
  }

  // Deleta asset com mesmo nome se existir
  const existingAsset = (release.assets || []).find(a => a.name === filename);
  if (existingAsset) {
    await fetch(`https://api.github.com/repos/${repo}/releases/assets/${existingAsset.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
  }

  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(filename)}`);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': contentType },
    body: buffer
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Erro ao fazer upload do JAR: ${uploadRes.status} ${uploadRes.statusText} - ${errText.slice(0, 200)}`);
  }
  const asset = await uploadRes.json();
  log.info('asset criado no GitHub', { assetId: asset.id, name: asset.name, state: asset.state, apiUrl: asset.url, browser_download_url: asset.browser_download_url });

  // Para repos privados, a browser_download_url (github.com/...) nao funciona
  // com bearer token — o GitHub retorna 404. Usamos a API URL (api.github.com/...)
  // que aceita bearer token e redireciona para uma URL assinada.
  const downloadUrl = asset.url || asset.browser_download_url;

  // O GitHub pode demorar alguns segundos para propagar o asset apos o upload.
  // Espera e tenta baixar a URL para garantir que ela ja esta acessivel.
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 5; i++) {
    try {
      const test = await fetchOriginalJar(downloadUrl);
      log.info('URL do asset verificada apos upload', { downloadUrl, attempts: i + 1, size: test.length });
      return downloadUrl;
    } catch (err) {
      log.warn('aguardando propagacao do asset no GitHub', { downloadUrl, attempt: i + 1, error: err.message });
      // Reconsulta o asset pela API para pegar a URL mais recente
      try {
        const assetCheck = await fetch(asset.url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
        if (assetCheck.ok) {
          const assetData = await assetCheck.json();
          if (assetData.url && assetData.url !== downloadUrl) {
            log.info('URL do asset atualizada pela API', { oldUrl: downloadUrl, newUrl: assetData.url });
          }
        }
      } catch (apiErr) {
        log.warn('nao foi possivel reconsultar asset no GitHub', { error: apiErr.message });
      }
      if (i < 4) await wait(2000);
    }
  }

  return downloadUrl;
}

/**
 * Gera uma build personalizada (watermark) do JAR para um comprador.
 *
 * O watermark é um JWT assinado com RS256 (mesma chave da API de licença)
 * inserido dentro do JAR em `/cafe-watermark.jwt`. Ele contém:
 * licenseKey, orderId, buyerEmail, productId e issuedAt.
 *
 * O plugin Java lê esse arquivo e valida com a chave pública. Como o JWT
 * é assinado pelo backend, o cliente não pode alterar o watermark; se o
 * JAR vazar, dá para rastrear qual pedido/origem vazou.
 */
export async function createWatermarkedJar({ originalUrl, licenseKey, orderId, buyerEmail, productId }) {
  if (!LICENSE_PRIVATE_KEY) {
    throw new Error('LICENSE_PRIVATE_KEY não configurado');
  }
  // Valida formato da chave privada antes de tentar usar
  try {
    const keyObj = jwt.decode('eyJhbGciOiJSUzI1NiJ9.e30.', { complete: true });
    if (!keyObj) throw new Error('invalid');
  } catch {
    // teste de decodificação não garante que a chave é válida; tentamos assinar algo pequeno
  }
  try {
    jwt.sign({ test: 1 }, LICENSE_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '1s' });
  } catch (e) {
    throw new Error(`LICENSE_PRIVATE_KEY inválida: ${e.message}`);
  }

  if (!originalUrl || !licenseKey || !orderId || !productId) {
    throw new Error('Parâmetros insuficientes para gerar JAR watermarkado');
  }

  log.info('gerando build watermarkada', { orderId, productId, buyerEmail, originalUrl });

  const jarBuffer = await fetchOriginalJar(originalUrl);

  let zip;
  try {
    zip = new AdmZip(jarBuffer);
  } catch (e) {
    throw new Error(`Falha ao ler JAR original: ${e.message}`);
  }

  let watermark;
  try {
    watermark = jwt.sign(
      {
        licenseKey,
        orderId,
        buyerEmail: buyerEmail || '',
        productId,
        issuedAt: new Date().toISOString()
      },
      LICENSE_PRIVATE_KEY,
      {
        algorithm: 'RS256',
        expiresIn: '10y',
        issuer: 'cafe-plugins',
        audience: productId
      }
    );
  } catch (e) {
    throw new Error(`Falha ao assinar watermark: ${e.message}`);
  }

  // Remove watermark antigo se existir (re-download)
  try { zip.deleteFile('cafe-watermark.jwt'); } catch {}
  zip.addFile('cafe-watermark.jwt', Buffer.from(watermark, 'utf-8'));

  let out;
  try {
    out = zip.toBuffer();
  } catch (e) {
    throw new Error(`Falha ao gerar JAR final: ${e.message}`);
  }

  log.info('build watermarkada gerada', { orderId, productId, size: out.length });
  return out;
}

export function filenameForDownload({ productName, productId }) {
  const safe = String(productName || productId)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}-licenciado.jar`;
}

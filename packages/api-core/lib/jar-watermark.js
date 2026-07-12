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
export async function uploadJarToGitHubRelease({ buffer, productId, productName, version = 'v1.0.0' }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN não configurado no .env');
  }
  const repo = process.env.GITHUB_PLUGIN_REPO || 'oTalentz/Bestiary-Plugin-CafePlugins2026';
  const safeName = String(productName || productId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeName}-${version}.jar`;

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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/java-archive' },
    body: buffer
  });
  if (!uploadRes.ok) {
    throw new Error(`Erro ao fazer upload do JAR: ${uploadRes.status}`);
  }
  const asset = await uploadRes.json();
  return asset.browser_download_url;
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

  const res = await fetch(originalUrl, { redirect: 'follow' });
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

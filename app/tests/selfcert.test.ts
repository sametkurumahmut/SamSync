import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { makeSelfSignedCert, webCertificate } from '../src/core/selfcert';
import { tmpDir } from './helpers';

describe('self-signed certificate for the web interface', () => {
  it('is a valid certificate for the names and addresses given', () => {
    const c = makeSelfSignedCert(['localhost', 'box'], ['127.0.0.1', '10.0.0.5']);
    const x = new crypto.X509Certificate(c.cert);
    expect(x.subject).toBe('CN=localhost');
    expect(x.verify(x.publicKey)).toBe(true);
    expect(x.checkHost('localhost')).toBe('localhost');
    expect(x.checkHost('box')).toBe('box');
    expect(x.checkIP('10.0.0.5')).toBe('10.0.0.5');
    expect(x.checkPrivateKey(crypto.createPrivateKey(c.key))).toBe(true);
    expect(Date.parse(x.validTo) - Date.now()).toBeGreaterThan(700 * 86400_000);
  });

  it('serves TLS that a client trusting it accepts', async () => {
    const c = makeSelfSignedCert(['localhost'], ['127.0.0.1']);
    const srv = https.createServer({ cert: c.cert, key: c.key }, (_q, r) => r.end('ok'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      const port = (srv.address() as { port: number }).port;
      const body = await new Promise<string>((resolve, reject) => {
        https
          .get({ host: '127.0.0.1', port, path: '/', ca: c.cert }, (res) => {
            let b = '';
            res.on('data', (d) => (b += d));
            res.on('end', () => resolve(b));
          })
          .on('error', reject);
      });
      expect(body).toBe('ok');
    } finally {
      srv.close();
    }
  });

  it('is kept and made again only when it runs out', async () => {
    const dir = await tmpDir();
    const a = await webCertificate(dir);
    const b = await webCertificate(dir);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(await fsp.readFile(path.join(dir, 'webui-key.pem'), 'utf8')).toContain('PRIVATE KEY');
    // two years on, it is about to run out: a new one
    const later = await webCertificate(dir, new Date(Date.now() + 720 * 86400_000));
    expect(later.fingerprint).not.toBe(a.fingerprint);
  });
});

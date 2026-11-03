/**
 * Read a site's HTTPS certificate: who issued it, when it expires, and whether
 * a browser would trust it. Mirrors engine/ssl.js in the DropPerch repo.
 *
 * rejectUnauthorized is off on purpose: an expired or untrusted certificate is
 * exactly the thing worth reporting, and a strict handshake would hide it
 * behind a generic error.
 */
import tls from 'node:tls'

export function probe(host, { port = 443, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }

    const socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    })

    const timer = setTimeout(
      () => done({ ok: false, host, reason: 'timeout', message: `no TLS answer in ${timeoutMs}ms` }),
      timeoutMs,
    )

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      if (!cert || !cert.valid_to) {
        done({ ok: false, host, reason: 'no-certificate', message: 'the server sent no certificate' })
        return
      }
      const identity = cert.subject ? tls.checkServerIdentity(host, cert) : null
      const validTo = new Date(cert.valid_to)
      const issuer = cert.issuer?.O || cert.issuer?.CN || null
      const error = socket.authorizationError || (identity ? identity.code || identity.message : null)
      done({
        ok: true,
        host,
        validFrom: new Date(cert.valid_from),
        validTo,
        issuer: Array.isArray(issuer) ? issuer[0] : issuer,
        subject: cert.subject?.CN ?? null,
        altNames: String(cert.subjectaltname || '')
          .split(',')
          .map((s) => s.trim().replace(/^DNS:/, ''))
          .filter(Boolean)
          .slice(0, 20),
        trusted: Boolean(socket.authorized) && !identity,
        error: error ? String(error) : null,
      })
    })

    socket.once('error', (err) => {
      done({ ok: false, host, reason: err.code || 'tls', message: err.message })
    })
  })
}

/**
 * The apex, or www when the apex has no trusted certificate (a forgotten
 * default vhost is common while www serves the real site).
 */
export async function checkCertificate(domain, opts) {
  const apex = await probe(domain, opts)
  if (apex.ok && apex.trusted) return apex
  const www = await probe(`www.${domain}`, opts)
  if (www.ok && (www.trusted || !apex.ok)) return www
  return apex
}

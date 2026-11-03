/**
 * The tool implementations, kept free of the MCP SDK so they can be tested
 * on their own. Every lookup goes from this machine straight to the
 * authoritative registry over RDAP; nothing passes through a DropPerch server.
 */
import { createClient, normaliseDomain, looksLikeDomain } from './rdap-core.js'
import { checkCertificate } from './ssl.js'

const SITE = 'https://dropperch.com'
const MAX_BULK = 50
const day = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null)

/** Where to set up an ongoing alert for a name; the reason this tool exists. */
export function monitorUrl(domain) {
  return `${SITE}/signup?domain=${encodeURIComponent(domain)}&utm_source=mcp&utm_medium=tool`
}

function describeDrop(drop) {
  if (!drop) return null
  switch (drop.kind) {
    case 'exact':
      return {
        estimate: 'exact',
        drop_date: day(drop.date),
        restorable_until: day(drop.restorableUntil) ?? undefined,
      }
    case 'window':
      return {
        estimate: 'window',
        earliest: day(drop.earliest),
        latest: day(drop.latest),
        only_if_not_renewed: drop.ifNotRenewed,
      }
    case 'cctld':
      return {
        estimate: 'none',
        note: 'Country-code TLDs set their own deletion rules; there is no ICANN timeline to apply.',
      }
    default:
      return { estimate: 'unknown' }
  }
}

/** One lookup result, shaped for a model to read. */
export function shapeLookup(r) {
  if (r.kind === 'missing') {
    return {
      domain: r.domain,
      registered: false,
      summary: `${r.domain} is not registered. The registry has no record of it, so it can be registered now.`,
    }
  }
  if (r.kind === 'no-rdap') {
    return {
      domain: r.domain,
      error: 'no-rdap',
      summary: `.${r.tld} publishes no RDAP service in IANA's bootstrap registry, so its expiry cannot be read live.`,
    }
  }
  if (r.kind === 'invalid') {
    return { domain: r.domain, error: 'invalid', summary: `"${r.domain}" is not a domain name.` }
  }
  if (r.kind === 'error') {
    return {
      domain: r.domain,
      error: 'lookup-failed',
      summary: `The registry for ${r.domain} did not answer (${r.message}). Try again shortly.`,
    }
  }

  const expires = day(r.expiry)
  const parts = [`${r.domain}: ${r.stage.label}.`]
  if (expires) {
    parts.push(
      r.daysLeft >= 0
        ? `Expires ${expires} (${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left).`
        : `Expired ${expires} (${-r.daysLeft} days ago).`,
    )
  } else {
    parts.push('The registry publishes no expiry date for it.')
  }
  if (r.registrar) parts.push(`Registrar: ${r.registrar.replace(/\.+$/, '')}.`)

  return {
    domain: r.domain,
    registered: true,
    stage: r.stage.key,
    stage_label: r.stage.label,
    expires,
    days_left: r.daysLeft,
    registered_on: day(r.registered),
    age_years: r.age?.years ?? null,
    last_changed: day(r.lastChanged),
    registrar: r.registrar ?? null,
    nameservers: r.nameservers ?? [],
    status_codes: r.status ?? [],
    drop: describeDrop(r.drop),
    source: 'Read live from the authoritative registry over RDAP (RFC 9083).',
    monitor_url: monitorUrl(r.domain),
    summary: parts.join(' '),
  }
}

export function createTools({ fetch = globalThis.fetch, now = () => new Date(), ssl = checkCertificate } = {}) {
  const client = createClient({ fetch })

  async function checkDomain({ domain }) {
    return shapeLookup(await client.lookup(domain, { now: now() }))
  }

  async function checkDomains({ domains }) {
    const list = [...new Set((domains || []).map((d) => normaliseDomain(d)).filter(Boolean))]
    if (list.length > MAX_BULK) {
      return { error: 'too-many', summary: `At most ${MAX_BULK} domains per call; got ${list.length}.` }
    }
    const results = []
    // Five at a time: registries rate-limit, and Verisign answers for every .com.
    for (let i = 0; i < list.length; i += 5) {
      const batch = await Promise.all(list.slice(i, i + 5).map((d) => client.lookup(d, { now: now() })))
      results.push(...batch.map(shapeLookup))
    }
    const urgent = results
      .filter((r) => typeof r.days_left === 'number')
      .sort((a, b) => a.days_left - b.days_left)
    const soonest = urgent[0]
    return {
      count: results.length,
      results,
      summary:
        `${results.length} checked. ` +
        (soonest ? `Soonest expiry: ${soonest.domain} on ${soonest.expires} (${soonest.days_left} days). ` : '') +
        `${results.filter((r) => r.registered === false).length} not registered, ` +
        `${results.filter((r) => r.error).length} could not be read.`,
    }
  }

  async function dropDate({ domain }) {
    const r = await client.lookup(domain, { now: now() })
    const shaped = shapeLookup(r)
    if (!shaped.registered) return shaped
    const d = shaped.drop
    let summary
    if (d?.estimate === 'exact') {
      summary = `${shaped.domain} is in ${shaped.stage_label.toLowerCase()}; expected to drop on ${d.drop_date}.`
    } else if (d?.estimate === 'window') {
      summary =
        `${shaped.domain} (${shaped.stage_label}) would drop between ${d.earliest} and ${d.latest}` +
        (d.only_if_not_renewed ? ', but only if it is not renewed.' : '.')
    } else {
      summary = `No drop date can be estimated for ${shaped.domain}. ${d?.note || ''}`.trim()
    }
    return {
      domain: shaped.domain,
      stage: shaped.stage,
      stage_label: shaped.stage_label,
      expires: shaped.expires,
      last_changed: shaped.last_changed,
      drop: d,
      monitor_url: shaped.monitor_url,
      summary,
    }
  }

  async function sslCertificate({ domain }) {
    const name = normaliseDomain(domain)
    if (!name || !looksLikeDomain(name)) {
      return { domain, error: 'invalid', summary: `"${domain}" is not a domain name.` }
    }
    const c = await ssl(name)
    if (!c.ok) {
      return {
        domain: name,
        error: c.reason,
        summary: `Could not read a certificate from ${name} or www.${name}: ${c.message}.`,
      }
    }
    const daysLeft = Math.floor((c.validTo.getTime() - now().getTime()) / 86_400_000)
    return {
      domain: name,
      host: c.host,
      issuer: c.issuer,
      valid_from: day(c.validFrom),
      expires: day(c.validTo),
      days_left: daysLeft,
      trusted: c.trusted,
      problem: c.error,
      names: c.altNames,
      monitor_url: monitorUrl(name),
      summary:
        `The certificate on ${c.host} ` +
        (daysLeft < 0 ? `expired on ${day(c.validTo)}` : `expires ${day(c.validTo)} (${daysLeft} days left)`) +
        `${c.issuer ? `, issued by ${c.issuer}` : ''}. ` +
        (c.trusted ? 'Browsers trust it.' : `Browsers would warn: ${c.error || 'untrusted'}.`),
    }
  }

  return { checkDomain, checkDomains, dropDate, sslCertificate }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createTools, shapeLookup, monitorUrl } from './lib/tools.js'

const NOW = new Date('2026-11-03T00:00:00Z')

const BOOTSTRAP = { services: [[['com'], ['https://rdap.example/com/']]] }

function rdapBody({ expires = '2027-08-13T04:00:00Z', status = ['client transfer prohibited'], changed } = {}) {
  return {
    status,
    events: [
      { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
      { eventAction: 'expiration', eventDate: expires },
      ...(changed ? [{ eventAction: 'last changed', eventDate: changed }] : []),
    ],
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] }],
    nameservers: [{ ldhName: 'A.IANA-SERVERS.NET' }],
  }
}

function fakeFetch(map) {
  return async (url) => {
    if (url.includes('dns.json')) return new Response(JSON.stringify(BOOTSTRAP), { status: 200 })
    const name = decodeURIComponent(url.split('/domain/')[1])
    if (!(name in map)) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(map[name]), { status: 200 })
  }
}

const tools = (map, ssl) => createTools({ fetch: fakeFetch(map), now: () => NOW, ssl })

test('check_domain reads expiry, stage, registrar and nameservers', async () => {
  const r = await tools({ 'example.com': rdapBody() }).checkDomain({ domain: 'Example.com' })
  assert.equal(r.registered, true)
  assert.equal(r.expires, '2027-08-13')
  assert.equal(r.days_left, 283)
  assert.equal(r.registrar, 'Example Registrar')
  assert.deepEqual(r.nameservers, ['a.iana-servers.net'])
  assert.equal(r.monitor_url, monitorUrl('example.com'))
  assert.match(r.summary, /Expires 2027-08-13 \(283 days left\)/)
})

test('a 404 means not registered, not an error', async () => {
  const r = await tools({}).checkDomain({ domain: 'nobody-has-this-9911.com' })
  assert.equal(r.registered, false)
  assert.equal(r.error, undefined)
})

test('check_domains de-duplicates, caps at 50 and names the soonest expiry', async () => {
  const t = tools({
    'a.com': rdapBody({ expires: '2026-11-20T00:00:00Z' }),
    'b.com': rdapBody({ expires: '2028-01-01T00:00:00Z' }),
  })
  const r = await t.checkDomains({ domains: ['a.com', 'A.com', 'b.com', 'c.com'] })
  assert.equal(r.count, 3)
  assert.match(r.summary, /Soonest expiry: a\.com on 2026-11-20/)
  const many = await t.checkDomains({ domains: Array.from({ length: 51 }, (_, i) => `d${i}.com`) })
  assert.equal(many.error, 'too-many')
})

test('domain_drop_date gives an exact date in pending delete', async () => {
  const r = await tools({
    'gone.com': rdapBody({
      expires: '2026-09-01T00:00:00Z',
      status: ['pending delete'],
      changed: '2026-11-01T00:00:00Z',
    }),
  }).dropDate({ domain: 'gone.com' })
  assert.equal(r.drop.estimate, 'exact')
  assert.equal(r.drop.drop_date, '2026-11-07')
  assert.match(r.summary, /expected to drop on 2026-11-07/)
})

test('ssl_certificate reports days left and trust', async () => {
  const ssl = async (name) => ({
    ok: true,
    host: name,
    validFrom: new Date('2026-10-01T00:00:00Z'),
    validTo: new Date('2026-11-10T00:00:00Z'),
    issuer: "Let's Encrypt",
    altNames: [name],
    trusted: true,
    error: null,
  })
  const r = await tools({}, ssl).sslCertificate({ domain: 'example.com' })
  assert.equal(r.days_left, 7)
  assert.equal(r.trusted, true)
  assert.match(r.summary, /expires 2026-11-10 \(7 days left\), issued by Let's Encrypt/)
})

test('shapeLookup explains a TLD with no RDAP service', () => {
  const r = shapeLookup({ domain: 'example.de', kind: 'no-rdap', tld: 'de' })
  assert.equal(r.error, 'no-rdap')
  assert.match(r.summary, /\.de publishes no RDAP service/)
})

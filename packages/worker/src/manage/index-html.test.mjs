import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1]

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data
    },
    async text() {
      return JSON.stringify(data)
    },
  }
}

function createNode(tagName = 'div') {
  const attributes = new Map()
  const classSet = new Set()
  const node = {
    tagName: tagName.toUpperCase(),
    attributes,
    children: [],
    style: {},
    className: '',
    disabled: false,
    checked: false,
    value: '',
    textContent: '',
    id: '',
    type: tagName === 'input' ? 'text' : undefined,
    classList: {
      add: (...tokens) => {
        tokens.forEach(token => classSet.add(token))
        node.className = Array.from(classSet).join(' ')
      },
      remove: (...tokens) => {
        tokens.forEach(token => classSet.delete(token))
        node.className = Array.from(classSet).join(' ')
      },
    },
    append: (...items) => {
      for (const item of items) {
        node.children.push(item)
        node.textContent += typeof item === 'string' ? item : String(item?.textContent ?? '')
      }
    },
    appendChild: item => {
      node.append(item)
      return item
    },
    replaceChildren: (...items) => {
      node.children = []
      node.textContent = ''
      node.append(...items)
    },
    setAttribute: (name, value) => {
      attributes.set(name, String(value))
      if (name === 'id') node.id = String(value)
      if (name === 'type') node.type = String(value)
    },
    getAttribute: name => attributes.get(name) ?? null,
    addEventListener: () => {},
    querySelectorAll: selector => {
      const matches = []
      const walk = current => {
        for (const child of current.children) {
          if (typeof child === 'string') continue
          if (selector === 'input[type="checkbox"]' || selector === 'input[type="checkbox"]:checked') {
            if (child.tagName === 'INPUT' && child.type === 'checkbox') {
              if (selector.endsWith(':checked') ? child.checked : true) {
                matches.push(child)
              }
            }
          }
          walk(child)
        }
      }
      walk(node)
      return matches
    },
  }
  return node
}

async function createManageHarness() {
  if (!script) {
    throw new Error('failed to extract manage script')
  }

  const allNodes = []
  const nodesById = new Map()
  const registerNode = (id, tagName = 'div') => {
    const node = createNode(tagName)
    node.id = id
    nodesById.set(id, node)
    allNodes.push(node)
    return node
  }

  const secretRequiredIds = new Set([
    'cron-authorize',
    'cron-clear',
    'cron-callback-input',
    'cron-callback-submit',
    'userA',
    'userB',
    'start-oauth',
    'sync-direction',
    'full-sync',
    'partial-sync-toggle',
    'partial-sync-start',
    'select-all',
  ])

  const allIds = [
    'gate',
    'gate-help',
    'gate-input',
    'gate-submit',
    'cron-status',
    'cron-manual',
    'cron-callback-input',
    'cron-callback-submit',
    'cron-authorize',
    'cron-clear',
    'oauth-status',
    'oauth-buttons',
    'step3-summary',
    'partial-list',
    'diff-list',
    'sync-results',
    'progress-fill',
    'progress-text',
    'userA',
    'userB',
    'start-oauth',
    'sync-direction',
    'full-sync',
    'partial-sync-toggle',
    'partial-sync-start',
    'select-all',
    'reset-button',
    'step1',
    'step2',
    'step3',
    'step4',
  ]
  for (const id of allIds) {
    const tagName = id.includes('input') || id === 'userA' || id === 'userB' || id === 'gate-input' || id === 'sync-direction' || id === 'select-all' ? 'input' : 'div'
    registerNode(id, tagName)
  }

  for (const id of secretRequiredIds) {
    nodesById.get(id).setAttribute('data-requires-secret', 'true')
  }

  const stepNodes = ['step1', 'step2', 'step3', 'step4'].map(id => nodesById.get(id))
  const fetchCalls = []
  const oauthResponses = [
    { url: 'https://bgm.example/oauth-1', state: 'state-1', nonce: 'nonce-1' },
    { url: 'https://bgm.example/oauth-2', state: 'state-2', nonce: 'nonce-2' },
    { url: 'https://bgm.example/oauth-3', state: 'state-3', nonce: 'nonce-3' },
  ]

  let resolveExchange
  const exchangePending = new Promise(resolve => {
    resolveExchange = resolve
  })

  const context = vm.createContext({
    Headers,
    URL,
    atob,
    btoa,
    crypto: globalThis.crypto,
    console,
    confirm: () => true,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options })
      if (url === '/api/manage/oauth-url') {
        const payload = oauthResponses.shift()
        if (!payload) throw new Error('unexpected oauth-url request')
        return jsonResponse(payload)
      }
      if (url === '/api/manage/exchange') {
        return exchangePending
      }
      throw new Error(`unexpected fetch ${url}`)
    },
    location: {
      origin: 'https://worker.example',
      reload: () => {},
    },
    window: {
      open: () => ({ closed: false, close() { this.closed = true } }),
      addEventListener: () => {},
    },
    document: {
      getElementById(id) {
        return nodesById.get(id) || registerNode(id)
      },
      querySelectorAll(selector) {
        if (selector === '.step') {
          return stepNodes
        }
        if (selector === '[data-requires-secret]') {
          return Array.from(nodesById.values()).filter(node => node.getAttribute('data-requires-secret') === 'true')
        }
        return []
      },
      createElement(tagName) {
        const node = createNode(tagName)
        allNodes.push(node)
        return node
      },
    },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  })
  context.fetchCalls = fetchCalls
  context.globalThis = context
  context.window.document = context.document
  context.window.location = context.location
  context.window.confirm = context.confirm
  context.window.fetch = context.fetch
  context.window.Headers = Headers
  context.window.URL = URL
  context.window.atob = atob
  context.window.btoa = btoa
  context.window.crypto = globalThis.crypto
  context.window.console = console
  context.window.setTimeout = setTimeout
  context.window.clearTimeout = clearTimeout
  context.window.queueMicrotask = queueMicrotask

  vm.runInContext(
    `${script}\n;globalThis.__manageHooks = { beginOAuth, exchangeOAuth, pendingOAuth: () => pendingOAuth, state, oauthStatus, fetchCalls: globalThis.fetchCalls }`,
    context,
  )

  return {
    beginOAuth: (...args) => context.__manageHooks.beginOAuth(...args),
    exchangeOAuth: (...args) => context.__manageHooks.exchangeOAuth(...args),
    pendingOAuth: () => context.__manageHooks.pendingOAuth(),
    state: context.__manageHooks.state,
    oauthStatus: context.__manageHooks.oauthStatus,
    fetchCalls,
    resolveExchange: data => resolveExchange(jsonResponse(data)),
    nodesById,
    allNodes,
  }
}

test('management credentials stay memory-only', () => {
  assert.doesNotMatch(html, /sessionStorage|localStorage/)
  assert.match(html, /let manageSecret = ''/)
  assert.match(html, /let pendingOAuth = null/)
  assert.match(html, /tokenA:\s*''/)
  assert.match(html, /tokenB:\s*''/)
})

test('public page does not probe gate state or prompt for secrets', () => {
  assert.doesNotMatch(html, /\/api\/manage\/gate/)
  assert.doesNotMatch(html, /\bprompt\s*\(/)
  assert.doesNotMatch(html, /_retried/)
})

test('gate handling only re-shows password UI for 401 and 503', () => {
  assert.match(html, /response\.status === 401 \|\| response\.status === 503/)
  assert.match(html, /document\.getElementById\('gate'\)\.style\.display = 'block'/)
})

test('oauth url creation uses a direct json post with purpose body', () => {
  assert.match(html, /const headers = new Headers\(\{ 'Content-Type': 'application\/json' \}\)/)
  assert.match(html, /const response = await fetch\('\/api\/manage\/oauth-url', \{/)
  assert.match(html, /body:\s*JSON\.stringify\(\{\s*purpose\s*\}\)/)
  assert.doesNotMatch(html, /apiFetch\('\/api\/manage\/oauth-url'/)
  assert.doesNotMatch(html, /\/api\/manage\/oauth-url\?/)
})

test('oauth exchange uses json post and never query params', () => {
  assert.match(html, /apiFetch\('\/api\/manage\/exchange',\s*\{/)
  assert.match(html, /body:\s*JSON\.stringify\(\{\s*code,\s*state\s*:\s*signedState\s*\}\)/)
  assert.doesNotMatch(html, /\/api\/manage\/exchange\?/)
})

test('stale oauth exchange cannot write token/ui or launch the next flow after a new flow starts', async () => {
  const harness = await createManageHarness()
  harness.state.userA = '账号甲'
  harness.state.userB = '账号乙'

  await harness.beginOAuth('account-a')
  const firstFlow = harness.pendingOAuth()
  const staleExchange = harness.exchangeOAuth('stale-code', firstFlow.state, firstFlow)

  await harness.beginOAuth('account-a')
  const currentFlow = harness.pendingOAuth()

  harness.resolveExchange({ access_token: 'stale-token' })
  await staleExchange

  assert.strictEqual(harness.pendingOAuth(), currentFlow)
  assert.equal(harness.state.tokenA, '')
  assert.equal(harness.fetchCalls.filter(call => call.url === '/api/manage/oauth-url').length, 2)
  assert.match(harness.oauthStatus.textContent, /请在弹出窗口完成 .*账号甲 授权/)
})

test('pending oauth keeps popup state nonce and purpose together', () => {
  assert.match(html, /const flow = \{\s*purpose,\s*state:\s*data\.state,\s*nonce:\s*data\.nonce,\s*popup:\s*null,\s*consuming:\s*false\s*\}/)
  assert.match(html, /pendingOAuth = flow/)
  assert.match(html, /const popup = window\.open\(data\.url,\s*'bgm-oauth'/)
})

test('oauth message handling binds origin popup and exact state', () => {
  assert.match(html, /window\.addEventListener\('message',\s*async\s*\(ev\)\s*=>/)
  assert.match(html, /ev\.origin !== location\.origin/)
  assert.match(html, /const flow = pendingOAuth/)
  assert.match(html, /ev\.source !== flow\.popup/)
  assert.match(html, /d\.state !== flow\.state/)
})

test('oauth message handling cross-checks decoded state purpose and nonce', () => {
  assert.match(html, /parseStatePayload\(/)
  assert.match(html, /payload\.nonce !== flow\.nonce/)
  assert.match(html, /payload\.purpose !== flow\.purpose/)
})

test('oauth exchange is single-flight and stale cleanup cannot clear a newer flow', () => {
  assert.match(html, /const flow = pendingOAuth/)
  assert.match(html, /if \(flow\.consuming\) return/)
  assert.match(html, /flow\.consuming = true/)
  assert.match(html, /if \(pendingOAuth === flow\) \{\s*resetPendingOAuth\(\)\s*\}/s)
})

test('manual callback requires same origin and matching pending state', () => {
  assert.match(html, /new URL\(rawUrl\)/)
  assert.match(html, /url\.origin !== location\.origin/)
  assert.match(html, /const flow = pendingOAuth/)
  assert.match(html, /url\.searchParams\.get\('state'\) !== flow\.state/)
  assert.match(html, /return consumeOAuthFlow\(flow,\s*code,\s*flow\.state\)/)
})

test('beginOAuth closes stale popup and clears pending state before opening a new one', () => {
  assert.match(html, /closePendingPopup\(\)/)
  assert.match(html, /resetPendingOAuth\(\)/)
  assert.match(html, /if \(!popup\) \{\s*resetPendingOAuth\(\)/s)
  assert.match(html, /授权弹窗打开失败，请稍后重试/)
  assert.doesNotMatch(html, /浏览器拦截/)
})

test('auth failures always show the same management password message', () => {
  assert.match(html, /管理验证失败，请重新输入密码/)
  assert.match(html, /response\.status === 401 \|\| response\.status === 503/)
})

test('cron success depends on ok true and account flows only accept access_token', () => {
  assert.match(html, /data\.ok === true/)
  assert.match(html, /if \(!data\.access_token\)/)
})

test('manual oauth controls are marked as requiring the management secret', () => {
  assert.match(html, /input\.setAttribute\('data-requires-secret', 'true'\)/)
  assert.match(html, /button\.setAttribute\('data-requires-secret', 'true'\)/)
})

test('dynamic difference checkboxes are marked as requiring the management secret', () => {
  assert.match(html, /checkbox\.setAttribute\('data-requires-secret', 'true'\)/)
  assert.match(html, /checkbox\.disabled = manageLocked/)
})

test('oauth-url launches create and verify a current launch before opening a popup', () => {
  assert.match(html, /let oauthLaunchGeneration = 0/)
  assert.match(html, /let currentOAuthLaunch = null/)
  assert.match(html, /currentOAuthLaunch = launch/)
  assert.match(html, /if \(currentOAuthLaunch !== launch\) return/)
  assert.match(html, /window\.open\(data\.url,\s*'bgm-oauth'\)/)
})

test('dynamic data rendering uses dom text apis and no innerHTML', () => {
  assert.doesNotMatch(html, /\.innerHTML\s*=/)
  assert.match(html, /createElement/)
  assert.match(html, /textContent/)
  assert.match(html, /replaceChildren/)
  assert.match(html, /addEventListener/)
})

test('interactive controls are wired with event listeners instead of inline handlers', () => {
  assert.doesNotMatch(html, /\sonclick=/)
  assert.doesNotMatch(html, /\sonchange=/)
})

/* dsh-bot-groups · 客户端 bundle
 *
 * 结构约束（踩过的坑）：
 * - 整个文件必须包在 IIFE 里，模块 id 必须等于 package.json name；
 * - factory 里才能 require('react')；
 * - 输出路径必须是 lib/client.js。
 */
(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return

  window.__ModuleLoader__.load({
    id: 'dsh-bot-groups',
    factory: function (require) {
      var React = null
      try {
        React = require('react')
      } catch (error) {
        React = null
      }
      if (!React) {
        return {
          name: 'dsh-bot-groups-client',
          inject: ['slots'],
          apply: function () {},
        }
      }

      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useRef = React.useRef
      var useCallback = React.useCallback
      var useMemo = React.useMemo

      var reactDom = null
      try {
        reactDom = require('react-dom')
      } catch (error) {
        reactDom = null
      }

      /* ----------------------------- 设计 token ----------------------------- */
      var T = {
        bg: 'var(--dsw-alias-bg-base)',
        l1: 'var(--dsw-alias-bg-layer-1)',
        l2: 'var(--dsw-alias-bg-layer-2)',
        l3: 'var(--dsw-alias-bg-layer-3)',
        border: 'var(--dsw-alias-border-l1)',
        border2: 'var(--dsw-alias-border-l2)',
        text: 'var(--dsw-alias-label-primary)',
        text2: 'var(--dsw-alias-label-secondary)',
        text3: 'var(--dsw-alias-label-tertiary)',
        fg: 'var(--dsw-alias-label-primary-foreground)',
        brand: 'var(--dsw-alias-brand-primary)',
        btn: 'var(--dsw-alias-button-primary-fill)',
        btnHover: 'var(--dsw-alias-button-primary-hover)',
        hover: 'var(--dsw-alias-interactive-bg-hover)',
        active: 'var(--dsw-alias-interactive-bg-active)',
        rXs: 'var(--dsw-radius-xs)',
        rSm: 'var(--dsw-radius-sm)',
        rMd: 'var(--dsw-radius-md)',
        rLg: 'var(--dsw-radius-lg)',
        font: 'var(--dsw-font-family)',
        shadow: 'var(--dsw-shadow-lv3)',
        ok: '#22a06b',
        warn: '#c47f17',
        err: '#d14343',
      }

      var MODES = [
        { value: 'mentions', label: '智能 @ 路由', hint: '@ 谁谁答；没人被 @ 时主持人接' },
        { value: 'round-robin', label: '依次发言', hint: '按成员顺序轮流说一句' },
        { value: 'panel', label: '全员圆桌', hint: '一轮里每位成员都发言' },
        { value: 'moderated', label: '主持人主导', hint: '主持人先答，被 @ 的人补充' },
      ]

      /* ------------------------------- 样式 -------------------------------- */
      var STYLE_ID = 'dsh-bot-groups-style'
      function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return
        var style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = [
          '.bgx-root{display:flex;flex-direction:column;min-height:0;height:100%;color:' + T.text + ';font-family:' + T.font + ';}',
          '.bgx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border-radius:' + T.rSm + ';border:1px solid ' + T.border + ';background:transparent;color:' + T.text + ';font-size:12.5px;cursor:pointer;white-space:nowrap;}',
          '.bgx-btn:hover{background:' + T.hover + ';}',
          '.bgx-btn:active{background:' + T.active + ';}',
          '.bgx-btn[data-kind="primary"]{background:' + T.btn + ';border-color:transparent;color:' + T.fg + ';}',
          '.bgx-btn[data-kind="primary"]:hover{background:' + T.btnHover + ';}',
          '.bgx-btn[data-kind="danger"]{color:' + T.err + ';}',
          '.bgx-btn:disabled{opacity:.5;cursor:not-allowed;}',
          '.bgx-card{background:' + T.l2 + ';border:1px solid ' + T.border + ';border-radius:' + T.rLg + ';}',
          '.bgx-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:11px;background:' + T.l3 + ';color:' + T.text2 + ';}',
          '.bgx-mono{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);}',
          '.bgx-scroll{overflow:auto;min-height:0;scrollbar-width:thin;}',
          '.bgx-scroll::-webkit-scrollbar{width:8px;height:8px;}',
          '.bgx-scroll::-webkit-scrollbar-thumb{background:' + T.border2 + ';border-radius:8px;}',
          '.bgx-row{display:flex;align-items:center;gap:8px;}',
          '.bgx-group-item{display:flex;gap:9px;padding:9px 10px;border-radius:' + T.rMd + ';cursor:pointer;border:1px solid transparent;}',
          '.bgx-group-item:hover{background:' + T.hover + ';}',
          '.bgx-group-item[data-active="true"]{background:' + T.active + ';border-color:' + T.border + ';}',
          '.bgx-input,.bgx-textarea{width:100%;box-sizing:border-box;border:1px solid ' + T.border + ';border-radius:' + T.rSm + ';background:' + T.bg + ';color:' + T.text + ';font-size:12.5px;font-family:inherit;outline:none;padding:6px 8px;}',
          '.bgx-input:focus,.bgx-textarea:focus{border-color:' + T.brand + ';}',
          '.bgx-textarea{resize:none;line-height:1.55;}',
          '.bgx-msg{display:flex;gap:8px;align-items:flex-start;margin:10px 0;}',
          '.bgx-msg[data-left="true"]{flex-direction:row-reverse;}',
          '.bgx-bubble{max-width:min(78%,680px);border:1px solid ' + T.border + ';background:' + T.l2 + ';border-radius:' + T.rLg + ';padding:8px 11px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}',
          '.bgx-bubble[data-role="human"]{background:color-mix(in srgb, ' + T.brand + ' 14%, ' + T.l2 + ');border-color:color-mix(in srgb, ' + T.brand + ' 26%, ' + T.border + ');}',
          '.bgx-bubble[data-status="running"]{color:' + T.text3 + ';font-style:italic;}',
          '.bgx-bubble[data-status="failed"]{border-color:color-mix(in srgb, ' + T.err + ' 40%, ' + T.border + ');}',
          '.bgx-bubble[data-status="blocked"]{border-color:color-mix(in srgb, ' + T.warn + ' 45%, ' + T.border + ');}',
          '.bgx-sys{display:flex;justify-content:center;margin:8px 0;}',
          '.bgx-sys > span{max-width:80%;text-align:center;font-size:11.5px;color:' + T.text3 + ';background:' + T.l1 + ';border:1px solid ' + T.border + ';border-radius:999px;padding:3px 10px;}',
          '.bgx-avatar{width:30px;height:30px;flex:0 0 30px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;font-weight:600;user-select:none;}',
          '.bgx-dot{width:6px;height:6px;border-radius:999px;background:' + T.brand + ';}',
          '.bgx-pulse{animation:bgxPulse 1.4s ease-in-out infinite;}',
          '@keyframes bgxPulse{0%,100%{opacity:.35}50%{opacity:1}}',
          '.bgx-dialog-mask{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:9999;padding:24px;}',
          '.bgx-dialog{width:min(520px,92vw);max-height:86vh;display:flex;flex-direction:column;background:' + T.l2 + ';border:1px solid ' + T.border2 + ';border-radius:' + T.rLg + ';box-shadow:' + T.shadow + ';overflow:hidden;}',
          '.bgx-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:999px;border:1px solid ' + T.border + ';background:' + T.l1 + ';color:' + T.text2 + ';font-size:12px;cursor:pointer;max-width:220px;}',
          '.bgx-chip:hover{background:' + T.hover + ';color:' + T.text + ';}',
          '.bgx-chip[data-on="true"]{border-color:' + T.brand + ';color:' + T.text + ';background:color-mix(in srgb, ' + T.brand + ' 12%, ' + T.l1 + ');}',
          '.bgx-dock{display:flex;align-items:center;gap:6px;padding:2px 0;flex-wrap:wrap;}',
          '.bgx-label{font-size:11.5px;color:' + T.text3 + ';}',
          '.bgx-quote{max-width:min(78%,680px);margin-bottom:3px;padding:5px 8px;border-left:2px solid ' + T.border + ';background:' + T.l1 + ';border-radius:5px;font-size:11.5px;color:' + T.text3 + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
          '.bgx-linkbtn{border:none;background:none;padding:0;font-size:11.5px;color:' + T.brand + ';cursor:pointer;}',
          '.bgx-linkbtn:hover{text-decoration:underline;}',
          '.bgx-task{display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;}',
          '.bgx-task[data-done="true"] .bgx-task-title{text-decoration:line-through;color:' + T.text3 + ';}',
          '.bgx-field{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;}',
          '.bgx-field > span:first-child{min-width:64px;color:' + T.text3 + ';}',
          '.bgx-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;color:' + T.text3 + ';font-size:12.5px;text-align:center;padding:24px;}',
        ].join('\n')
        document.head.appendChild(style)
      }

      /* ------------------------------- 工具 -------------------------------- */
      function api(path, init) {
        var options = Object.assign({ headers: { 'content-type': 'application/json' } }, init || {})
        if (options.body && typeof options.body !== 'string') options.body = JSON.stringify(options.body)
        return fetch('/_dsh-bot-groups' + path, options).then(function (res) {
          return res
            .json()
            .catch(function () {
              return { ok: false, code: 'BAD_JSON', message: '服务端返回了非 JSON 响应' }
            })
            .then(function (data) {
              if (!data || data.ok !== true) {
                var error = new Error((data && (data.message || data.code)) || '请求失败')
                error.code = data && data.code
                throw error
              }
              return data.value
            })
        })
      }

      function fmtCost(value) {
        var n = Number(value) || 0
        if (n <= 0) return ''
        return n < 0.01 ? '¥' + n.toFixed(4) : '¥' + n.toFixed(2)
      }

      function fmtTime(iso) {
        if (!iso) return ''
        var date = new Date(iso)
        if (Number.isNaN(date.getTime())) return ''
        var now = new Date()
        var sameDay = date.toDateString() === now.toDateString()
        var hh = String(date.getHours()).padStart(2, '0')
        var mm = String(date.getMinutes()).padStart(2, '0')
        if (sameDay) return hh + ':' + mm
        return String(date.getMonth() + 1) + '/' + String(date.getDate()) + ' ' + hh + ':' + mm
      }

      function hashColor(text) {
        var hash = 0
        var value = String(text || '?')
        for (var i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
        var palette = ['#5b8def', '#8a63d2', '#2f9e8f', '#d2812f', '#c25a86', '#4f7d3a', '#7a6ad8', '#b0563c']
        return palette[Math.abs(hash) % palette.length]
      }

      function initials(name) {
        var value = String(name || '?').trim()
        if (!value) return '?'
        var emoji = value.match(/\p{Extended_Pictographic}/u)
        if (emoji) return emoji[0]
        return value.slice(0, 1).toUpperCase()
      }

      function MemberAvatar(props) {
        var size = props.size || 30
        var name = props.name || props.member && props.member.name || '?'
        return h(
          'div',
          {
            className: 'bgx-avatar',
            title: name,
            style: {
              width: size,
              height: size,
              flex: '0 0 ' + size + 'px',
              background: props.color || hashColor(name),
              fontSize: Math.round(size * 0.44),
            },
          },
          initials(name),
        )
      }

      function StatusPill(props) {
        var map = {
          running: { text: '思考中', color: T.warn },
          done: { text: '已回复', color: T.ok },
          failed: { text: '失败', color: T.err },
          blocked: { text: '演练拦截', color: T.warn },
          queued: { text: '排队中', color: T.text3 },
        }
        var hit = map[props.status]
        if (!hit) return null
        return h('span', { className: 'bgx-pill', style: { color: hit.color } }, hit.text)
      }

      /* ------------------------------ 数据 hooks ---------------------------- */
      function useOverview(intervalMs) {
        var state = useState(null)
        var data = state[0]
        var setData = state[1]
        var errState = useState('')
        var error = errState[0]
        var setError = errState[1]
        var tickRef = useRef(0)

        var load = useCallback(
          function () {
            return api('/overview')
              .then(function (value) {
                setData(value)
                setError('')
                return value
              })
              .catch(function (error) {
                setError(error && error.message ? error.message : String(error))
                return null
              })
          },
          [setData, setError],
        )

        useEffect(
          function () {
            var alive = true
            load()
            var timer = setInterval(function () {
              tickRef.current += 1
              if (!alive) return
              load()
            }, intervalMs || 8000)
            return function () {
              alive = false
              clearInterval(timer)
            }
          },
          [load, intervalMs],
        )

        return { data: data, error: error, reload: load }
      }

      /* ------------------------------- 消息渲染 ------------------------------ */
      function MessageRow(props) {
        var msg = props.message
        var group = props.group
        if (!msg) return null
        if (msg.kind === 'system') {
          return h('div', { className: 'bgx-sys' }, h('span', null, msg.text))
        }
        var isHuman = msg.role === 'human'
        var speaker = isHuman ? null : group.members.find(function (member) { return member.botId === msg.botId })
        var name = isHuman ? '你' : (speaker && speaker.name) || msg.name || msg.botId || 'Bot'
        var cost = fmtCost(msg.costCny)
        var meta = []
        if (!isHuman) meta.push(h(StatusPill, { key: 'st', status: msg.status }))
        if (cost) meta.push(h('span', { key: 'c', className: 'bgx-label' }, cost))
        meta.push(h('span', { key: 't', className: 'bgx-label' }, fmtTime(msg.at)))
        if (msg.status === 'running' && msg.text) meta.push(h('span', { key: 'p', className: 'bgx-label bgx-pulse' }, '生成中…'))
        if (msg.stopped) meta.push(h('span', { key: 's', className: 'bgx-label' }, '已停止'))
        if (!isHuman && props.onRetry) {
          meta.push(
            h(
              'button',
              {
                key: 'retry',
                type: 'button',
                className: 'bgx-linkbtn',
                onClick: function () {
                  props.onRetry(msg)
                },
              },
              '重试',
            ),
          )
        }

        var body = msg.text
        if (!body) {
          if (msg.status === 'running') body = '正在思考…'
          else if (msg.status === 'queued') body = '排队中…'
          else body = '（无内容）'
        }
        var quoted =
          msg.replyTo && Array.isArray(group.messages)
            ? group.messages.find(function (item) {
                return item.id === msg.replyTo
              })
            : null
        var quoteLine = quoted
          ? h(
              'div',
              { className: 'bgx-quote' },
              h('b', null, quoted.role === 'human' ? '你' : quoted.name || quoted.botId || 'Bot'),
              h('span', null, '　' + String(quoted.text || '').slice(0, 140)),
            )
          : null
        var files = (msg.attachments || []).map(function (file) {
          return h('div', { key: file.path || file.name, className: 'bgx-label' }, '📎 ' + (file.name || file.path))
        })
        return h(
          'div',
          { className: 'bgx-msg', 'data-left': isHuman ? 'true' : 'false' },
          h(MemberAvatar, { name: name, size: 30 }),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', alignItems: isHuman ? 'flex-end' : 'flex-start', minWidth: 0 } },
            h(
              'div',
              { className: 'bgx-row', style: { fontSize: 11.5, color: T.text3, marginBottom: 3 } },
              h('span', null, name),
              meta,
            ),
            quoteLine,
            h('div', { className: 'bgx-bubble', 'data-role': isHuman ? 'human' : 'bot', 'data-status': msg.status }, body),
            files.length > 0 ? h('div', { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 } }, files) : null,
          ),
        )
      }

      /* ------------------------------- 创建群 ------------------------------- */
      function CreateGroupDialog(props) {
        var bots = props.bots || []
        var nameState = useState('')
        var name = nameState[0]
        var setName = nameState[1]
        var selectedState = useState([])
        var selected = selectedState[0]
        var setSelected = selectedState[1]
        var kindState = useState('group')
        var kind = kindState[0]
        var setKind = kindState[1]
        var modeState = useState('mentions')
        var mode = modeState[0]
        var setMode = modeState[1]
        var topicState = useState('')
        var topic = topicState[0]
        var setTopic = topicState[1]
        var goalState = useState('')
        var goal = goalState[0]
        var setGoal = goalState[1]
        var roundsState = useState(3)
        var rounds = roundsState[0]
        var setRounds = roundsState[1]
        var busyState = useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var errState = useState('')
        var error = errState[0]
        var setError = errState[1]

        function toggle(bot) {
          setSelected(function (current) {
            if (current.indexOf(bot.id) >= 0) return current.filter(function (id) { return id !== bot.id })
            if (kind === 'dm') return [bot.id]
            return current.concat([bot.id])
          })
        }

        function submit() {
          if (selected.length === 0) {
            setError('至少选择一位 Bot')
            return
          }
          setBusy(true)
          api('/groups', {
            method: 'POST',
            body: {
              name: name.trim() || (kind === 'dm' ? bots.find(function (b) { return b.id === selected[0] })?.name + ' 与 你' : '新群'),
              kind: kind,
              members: selected,
              mode: mode,
              topic: topic.trim(),
              goal: goal.trim(),
              maxRounds: rounds,
            },
          })
            .then(function (value) {
              setBusy(false)
              props.onCreated(value.group)
            })
            .catch(function (error) {
              setBusy(false)
              setError(error.message || String(error))
            })
        }

        return h(
          'div',
          { className: 'bgx-dialog-mask', onMouseDown: function (event) { if (event.target === event.currentTarget) props.onClose() } },
          h(
            'div',
            { className: 'bgx-dialog' },
            h(
              'div',
              { className: 'bgx-row', style: { padding: '12px 14px', borderBottom: '1px solid ' + T.border, justifyContent: 'space-between' } },
              h('div', { style: { fontWeight: 600, fontSize: 14 } }, '拉个群'),
              h('button', { className: 'bgx-btn', onClick: props.onClose }, '关闭'),
            ),
            h(
              'div',
              { className: 'bgx-scroll', style: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 } },
              h(
                'div',
                { className: 'bgx-row' },
                h('button', { className: 'bgx-chip', 'data-on': kind === 'group' ? 'true' : 'false', onClick: function () { setKind('group') } }, '群聊'),
                h('button', { className: 'bgx-chip', 'data-on': kind === 'dm' ? 'true' : 'false', onClick: function () { setKind('dm'); setSelected(function (c) { return c.slice(0, 1) }) } }, '私聊（1 对 1）'),
              ),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h('span', { className: 'bgx-label' }, '群名'),
                h('input', { className: 'bgx-input', value: name, placeholder: kind === 'dm' ? '例如：和研究员 小海 聊聊' : '例如：上线评审小组', onChange: function (event) { setName(event.target.value) } }),
              ),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('span', { className: 'bgx-label' }, kind === 'dm' ? '选择一位 Bot' : '成员（至少一位）'),
                bots.length === 0
                  ? h('div', { className: 'bgx-label' }, '还没有 Bot。先在 Bot 面板创建一个 Bot，再回来拉群。')
                  : h(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                      bots.map(function (bot) {
                        return h(
                          'button',
                          {
                            key: bot.id,
                            className: 'bgx-chip',
                            'data-on': selected.indexOf(bot.id) >= 0 ? 'true' : 'false',
                            title: bot.role || bot.id,
                            onClick: function () { toggle(bot) },
                          },
                          h(MemberAvatar, { name: bot.name, size: 18 }),
                          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, bot.name),
                        )
                      }),
                    ),
              ),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h('span', { className: 'bgx-label' }, '主题（可选）'),
                h('input', { className: 'bgx-input', value: topic, placeholder: '这群要一起搞定什么', onChange: function (event) { setTopic(event.target.value) } }),
              ),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h('span', { className: 'bgx-label' }, '群目标（可选，会注入每次发言）'),
                h('textarea', { className: 'bgx-textarea', rows: 2, value: goal, placeholder: '例如：本周内完成 v0.2 的发布评审', onChange: function (event) { setGoal(event.target.value) } }),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                h(
                  'label',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160, flex: 1 } },
                  h('span', { className: 'bgx-label' }, '路由模式'),
                  h(
                    'select',
                    { className: 'bgx-input', value: mode, onChange: function (event) { setMode(event.target.value) } },
                    MODES.map(function (item) { return h('option', { key: item.value, value: item.value }, item.label) }),
                  ),
                ),
                h(
                  'label',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4, width: 130 } },
                  h('span', { className: 'bgx-label' }, '每轮最多接力'),
                  h('input', { className: 'bgx-input', type: 'number', min: 1, max: 12, value: rounds, onChange: function (event) { setRounds(Number(event.target.value) || 3) } }),
                ),
              ),
              error ? h('div', { style: { color: T.err, fontSize: 12 } }, error) : null,
            ),
            h(
              'div',
              { className: 'bgx-row', style: { padding: '10px 14px', borderTop: '1px solid ' + T.border, justifyContent: 'flex-end' } },
              h('button', { className: 'bgx-btn', onClick: props.onClose }, '取消'),
              h('button', { className: 'bgx-btn', 'data-kind': 'primary', disabled: busy, onClick: submit }, busy ? '创建中…' : '拉群'),
            ),
          ),
        )
      }

      /* ------------------------------ 主面板 Shell --------------------------- */
      function Shell(props) {
        var ctx = props.ctx
        var selectedState = useState(null)
        var selectedId = selectedState[0]
        var setSelectedId = selectedState[1]
        var detailState = useState(null)
        var detail = detailState[0]
        var setDetail = detailState[1]
        var draftState = useState('')
        var draft = draftState[0]
        var setDraft = draftState[1]
        var busyState = useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var errorState = useState('')
        var error = errorState[0]
        var setError = errorState[1]
        var modalState = useState(null)
        var modal = modalState[0]
        var setModal = modalState[1]
        var showMembersState = useState(true)
        var showMembers = showMembersState[0]
        var setShowMembers = showMembersState[1]
        var fastUntilRef = useRef(0)
        var lastMsgCountRef = useRef(0)
        var scrollRef = useRef(null)

        var running = Boolean(detail && (detail.running || (detail.messages || []).some(function (msg) { return msg.status === 'running' })))
        var interval = running || Date.now() < fastUntilRef.current ? 2000 : 9000
        var overview = useOverview(interval)
        var data = overview.data
        var groups = (data && data.groups) || []
        var bots = (data && data.bots) || []
        var diag = data && data.diag

        useEffect(
          function () {
            if (!data) return
            if (selectedId && groups.some(function (group) { return group.id === selectedId })) return
            if (groups.length > 0) {
              var first = groups.filter(function (group) { return !group.archived })[0] || groups[0]
              setSelectedId(first.id)
            }
          },
          [data, selectedId, groups, setSelectedId],
        )

        var loadDetail = useCallback(
          function (id) {
            if (!id) return Promise.resolve()
            return api('/groups/' + encodeURIComponent(id))
              .then(function (value) {
                setDetail(value.group)
                return value.group
              })
              .catch(function (error) {
                setError(error.message || String(error))
                return null
              })
          },
          [setDetail, setError],
        )

        useEffect(
          function () {
            if (!selectedId) {
              setDetail(null)
              return
            }
            loadDetail(selectedId)
            var timer = setInterval(function () {
              loadDetail(selectedId)
            }, interval)
            return function () { clearInterval(timer) }
          },
          [selectedId, loadDetail, interval],
        )

        useEffect(
          function () {
            var node = scrollRef.current
            if (!node || !detail) return
            var count = (detail.messages || []).length
            var shouldStick = count !== lastMsgCountRef.current || running
            lastMsgCountRef.current = count
            if (shouldStick) node.scrollTop = node.scrollHeight
          },
          [detail, running],
        )

        useEffect(
          function () {
            function onEvent(event) {
              if (!event) return
              if (event.type === 'create') setModal('create')
              if (event.type === 'select' && event.id) setSelectedId(event.id)
              if (event.type === 'open') {
                if (event.id) setSelectedId(event.id)
              }
            }
            return bus.on(onEvent)
          },
          [setModal, setSelectedId],
        )

        function markFast() {
          fastUntilRef.current = Date.now() + 120000
        }

        function sendMessage(quiet) {
          var text = draft.trim()
          if (!text || !selectedId) return
          setDraft('')
          setBusy(true)
          setError('')
          api('/groups/' + encodeURIComponent(selectedId) + '/messages', {
            method: 'POST',
            body: { text: text, reply: quiet !== true },
          })
            .then(function (value) {
              setDetail(value.group)
              overview.reload()
              if ((value.queued || []).length > 0) markFast()
            })
            .catch(function (error) {
              setError(error.message || String(error))
              setDraft(text)
            })
            .finally(function () { setBusy(false) })
        }

        function startRound() {
          if (!selectedId) return
          setBusy(true)
          api('/groups/' + encodeURIComponent(selectedId) + '/rounds', { method: 'POST', body: {} })
            .then(function () {
              markFast()
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
            .finally(function () { setBusy(false) })
        }

        function patchGroup(patch) {
          if (!selectedId) return
          api('/groups/' + encodeURIComponent(selectedId) + '/update', { method: 'POST', body: patch })
            .then(function (value) {
              setDetail(value.group)
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
        }

        function invite(botIds) {
          if (!selectedId) return
          api('/groups/' + encodeURIComponent(selectedId) + '/invite', { method: 'POST', body: { botIds: botIds } })
            .then(function (value) {
              setDetail(value.group)
              overview.reload()
              setModal(null)
            })
            .catch(function (error) { setError(error.message || String(error)) })
        }

        function removeMember(botId) {
          if (!selectedId) return
          api('/groups/' + encodeURIComponent(selectedId) + '/remove-members', { method: 'POST', body: { botIds: [botId] } })
            .then(function (value) {
              setDetail(value.group)
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
        }

        function removeGroup() {
          if (!selectedId) return
          if (!window.confirm('解散这个群？聊天记录会一起删除。')) return
          api('/groups/' + encodeURIComponent(selectedId), { method: 'DELETE' })
            .then(function () {
              setSelectedId(null)
              setDetail(null)
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
        }

        function insertMention(member) {
          setDraft(function (current) {
            var token = '@' + (member.name || member.botId) + ' '
            if (current.indexOf(token) >= 0) return current
            return current ? current.replace(/\s*$/, ' ') + token : token
          })
        }

        function stopGroup() {
          if (!selectedId) return
          setBusy(true)
          api('/groups/' + encodeURIComponent(selectedId) + '/stop', { method: 'POST', body: {} })
            .then(function (value) {
              setDetail(value.group)
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
            .finally(function () { setBusy(false) })
        }

        function retryMessage(message) {
          if (!selectedId || !message) return
          setBusy(true)
          api('/groups/' + encodeURIComponent(selectedId) + '/retry', { method: 'POST', body: { messageId: message.id } })
            .then(function () {
              markFast()
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
            .finally(function () { setBusy(false) })
        }

        function taskCall(body) {
          if (!selectedId) return
          api('/groups/' + encodeURIComponent(selectedId) + '/tasks', { method: 'POST', body: body })
            .then(function (value) {
              setDetail(value.group)
              overview.reload()
            })
            .catch(function (error) { setError(error.message || String(error)) })
        }

        function groupCall(action, body) {
          if (!selectedId) return
          api('/groups/' + encodeURIComponent(selectedId) + '/' + action, { method: 'POST', body: body || {} })
            .then(function () { overview.reload() })
            .catch(function (error) { setError(error.message || String(error)) })
        }

        var taskDraftState = useState('')
        var taskDraft = taskDraftState[0]
        var setTaskDraft = taskDraftState[1]
        var providerRows = (data && data.providers) || []

        var group = detail
        var members = (group && group.members) || []
        var leadName = group && group.leadBotId && (members.find(function (m) { return m.botId === group.leadBotId }) || {}).name

        return h(
          'div',
          { className: 'bgx-root', style: { flexDirection: 'row' } },
          /* 左栏：群列表 */
          h(
            'div',
            {
              style: {
                width: 248,
                flex: '0 0 248px',
                borderRight: '1px solid ' + T.border,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: T.l1,
              },
            },
            h(
              'div',
              { className: 'bgx-row', style: { padding: '10px 10px 6px', justifyContent: 'space-between' } },
              h('div', { style: { fontWeight: 600, fontSize: 13 } }, 'Bot 群'),
              h('button', { className: 'bgx-btn', 'data-kind': 'primary', onClick: function () { setModal('create') } }, '+ 拉群'),
            ),
            h(
              'div',
              { className: 'bgx-scroll', style: { padding: '4px 6px 10px', flex: 1 } },
              groups.length === 0
                ? h('div', { className: 'bgx-label', style: { padding: '12px 8px', lineHeight: 1.7 } }, '还没有群。把两位以上的 Bot 拉进一个群，它们就能互相接力干活。')
                : groups.map(function (item) {
                    return h(
                      'div',
                      {
                        key: item.id,
                        className: 'bgx-group-item',
                        'data-active': item.id === selectedId ? 'true' : 'false',
                        onClick: function () { setSelectedId(item.id) },
                      },
                      h(MemberAvatar, { name: item.avatar || item.name, size: 30, color: hashColor(item.name) }),
                      h(
                        'div',
                        { style: { minWidth: 0, flex: 1 } },
                        h(
                          'div',
                          { className: 'bgx-row', style: { justifyContent: 'space-between', gap: 6 } },
                          h('span', { style: { fontSize: 12.5, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
                          h('span', { className: 'bgx-label' }, fmtTime(item.updatedAt)),
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 } },
                          item.running ? h('span', { className: 'bgx-dot bgx-pulse' }) : null,
                          item.unread > 0 && !item.running ? h('span', { className: 'bgx-dot' }) : null,
                          h(
                            'span',
                            { className: 'bgx-label', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                            item.lastMessage ? item.lastMessage.name + '：' + item.lastMessage.text : '还没有消息',
                          ),
                        ),
                      ),
                    )
                  }),
            ),
            diag && diag.degraded
              ? h(
                  'div',
                  { style: { margin: 8, padding: 8, border: '1px dashed ' + T.border2, borderRadius: T.rSm, fontSize: 11.5, color: T.warn, lineHeight: 1.6 } },
                  '降级模式：' + (diag.reason || '未找到 Bot 运行时'),
                )
              : null,
          ),
          /* 中间：会话 */
          h(
            'div',
            { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } },
            !group
              ? h(
                  'div',
                  { className: 'bgx-empty' },
                  h('div', { style: { fontSize: 14, color: T.text2 } }, '选一个群，或者新建一个'),
                  bots.length === 0
                    ? h('div', null, '当前还没有 Bot。先到 Bot 面板创建 Bot，群聊才有意义。')
                    : h('button', { className: 'bgx-btn', 'data-kind': 'primary', onClick: function () { setModal('create') } }, '拉个群'),
                )
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    {
                      className: 'bgx-row',
                      style: { padding: '9px 14px', borderBottom: '1px solid ' + T.border, justifyContent: 'space-between', gap: 10, background: T.l1 },
                    },
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h(
                        'div',
                        { className: 'bgx-row', style: { gap: 8 } },
                        h('span', { style: { fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, group.name),
                        group.kind === 'dm' ? h('span', { className: 'bgx-pill' }, '私聊') : null,
                        h('span', { className: 'bgx-pill' }, (MODES.find(function (m) { return m.value === group.mode }) || MODES[0]).label),
                        group.running ? h('span', { className: 'bgx-pill', style: { color: T.warn } }, '进行中') : null,
                      ),
                      h(
                        'div',
                        { className: 'bgx-label', style: { marginTop: 2 } },
                        group.topic ? group.topic + ' · ' : '',
                        members.length + ' 位成员',
                        leadName ? ' · 主持人 ' + leadName : '',
                        group.goal ? ' · 目标：' + group.goal : '',
                      ),
                    ),
                    h(
                      'div',
                      { className: 'bgx-row', style: { gap: 6 } },
                      h('button', { className: 'bgx-btn', disabled: busy, onClick: startRound, title: '让成员依次发言一轮' }, '圆桌'),
                      group.running
                        ? h('button', { className: 'bgx-btn', 'data-kind': 'danger', disabled: busy, onClick: stopGroup, title: '停止正在进行的发言' }, '停止')
                        : null,
                      h('button', { className: 'bgx-btn', onClick: function () { setShowMembers(!showMembers) } }, showMembers ? '收起' : '成员'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'bgx-scroll', ref: scrollRef, style: { flex: 1, padding: '4px 16px 8px', background: T.bg } },
                    (group.messages || []).length === 0
                      ? h('div', { className: 'bgx-empty' }, '说点什么，让成员接起来。')
                      : (group.messages || []).map(function (msg) {
                          return h(MessageRow, { key: msg.id, message: msg, group: group, onRetry: retryMessage })
                        }),
                    error ? h('div', { style: { color: T.err, fontSize: 12, padding: '6px 0' } }, error) : null,
                  ),
                  h(
                    'div',
                    { style: { borderTop: '1px solid ' + T.border, padding: '8px 14px 12px', background: T.l1 } },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 7 } },
                      members.slice(0, 8).map(function (member) {
                        return h(
                          'button',
                          { key: member.botId, className: 'bgx-chip', onClick: function () { insertMention(member) }, title: '插入 @' + member.name },
                          h(MemberAvatar, { name: member.name, size: 16 }),
                          h('span', null, member.name),
                          member.botId === group.leadBotId ? h('span', { className: 'bgx-label' }, '主持') : null,
                        )
                      }),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
                      h('textarea', {
                        className: 'bgx-textarea',
                        rows: 2,
                        placeholder: '在群里说点什么…（@成员 可以点名；Enter 发送，Shift+Enter 换行）',
                        value: draft,
                        onChange: function (event) { setDraft(event.target.value) },
                        onKeyDown: function (event) {
                          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            sendMessage(false)
                          }
                        },
                      }),
                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                        h('button', { className: 'bgx-btn', 'data-kind': 'primary', disabled: busy || !draft.trim(), onClick: function () { sendMessage(false) } }, busy ? '发送中…' : '发送'),
                        h('button', { className: 'bgx-btn', disabled: busy || !draft.trim(), onClick: function () { sendMessage(true) }, title: '只发消息，不让 Bot 接力' }, '只发送'),
                      ),
                    ),
                  ),
                ),
          ),
          /* 右栏：成员 / 目标 / 设置 */
          showMembers && group
            ? h(
                'div',
                {
                  className: 'bgx-scroll',
                  style: { width: 264, flex: '0 0 264px', borderLeft: '1px solid ' + T.border, background: T.l1, padding: '10px 12px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
                },
                h(
                  'div',
                  null,
                  h('div', { className: 'bgx-label', style: { marginBottom: 6 } }, '成员'),
                  members.map(function (member) {
                    return h(
                      'div',
                      { key: member.botId, className: 'bgx-row', style: { padding: '4px 0', justifyContent: 'space-between' } },
                      h(
                        'div',
                        { className: 'bgx-row', style: { minWidth: 0 } },
                        h(MemberAvatar, { name: member.name, size: 24 }),
                        h(
                          'div',
                          { style: { minWidth: 0 } },
                          h('div', { style: { fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, member.name),
                          h('div', { className: 'bgx-label', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, member.alive === false ? '已删除' : member.role || member.botId),
                        ),
                      ),
                      h(
                        'button',
                        { className: 'bgx-btn', style: { height: 22, padding: '0 6px' }, title: '移出群', onClick: function () { removeMember(member.botId) } },
                        '移出',
                      ),
                    )
                  }),
                  h('button', { className: 'bgx-btn', style: { marginTop: 8, width: '100%' }, onClick: function () { setModal('invite') } }, '邀请更多 Bot'),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'bgx-label', style: { marginBottom: 6 } }, '路由模式'),
                  h(
                    'select',
                    { className: 'bgx-input', value: group.mode, onChange: function (event) { patchGroup({ mode: event.target.value }) } },
                    MODES.map(function (item) { return h('option', { key: item.value, value: item.value }, item.label) }),
                  ),
                  h('div', { className: 'bgx-label', style: { marginTop: 4, lineHeight: 1.6 } }, (MODES.find(function (m) { return m.value === group.mode }) || MODES[0]).hint),
                  h(
                    'div',
                    { className: 'bgx-row', style: { marginTop: 8, justifyContent: 'space-between' } },
                    h('span', { className: 'bgx-label' }, '每轮最多接力'),
                    h('input', {
                      className: 'bgx-input',
                      style: { width: 70 },
                      type: 'number',
                      min: 1,
                      max: 12,
                      value: group.maxRounds,
                      onChange: function (event) { patchGroup({ maxRounds: Number(event.target.value) || 3 }) },
                    }),
                  ),
                  h(
                    'div',
                    { className: 'bgx-row', style: { marginTop: 8, justifyContent: 'space-between' } },
                    h('span', { className: 'bgx-label' }, '主持人'),
                    h(
                      'select',
                      {
                        className: 'bgx-input',
                        style: { width: 140 },
                        value: group.leadBotId || '',
                        onChange: function (event) { patchGroup({ leadBotId: event.target.value }) },
                      },
                      members.map(function (member) { return h('option', { key: member.botId, value: member.botId }, member.name) }),
                    ),
                  ),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'bgx-label', style: { marginBottom: 6 } }, '群目标'),
                  h('textarea', {
                    className: 'bgx-textarea',
                    rows: 3,
                    value: group.goal || '',
                    placeholder: '一句话说清这个群要一起完成什么',
                    onChange: function (event) { setDetail(Object.assign({}, group, { goal: event.target.value })) },
                    onBlur: function (event) { patchGroup({ goal: event.target.value }) },
                  }),
                  h(
                    'div',
                    { className: 'bgx-row', style: { marginTop: 6, gap: 6 } },
                    ['active', 'paused', 'done'].map(function (status) {
                      return h(
                        'button',
                        { key: status, className: 'bgx-chip', 'data-on': group.goalStatus === status ? 'true' : 'false', onClick: function () { patchGroup({ goalStatus: status }) } },
                        status === 'active' ? '进行中' : status === 'paused' ? '暂停' : '已完成',
                      )
                    }),
                  ),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'bgx-label', style: { marginBottom: 6 } }, '任务看板'),
                  (group.tasks || []).length === 0
                    ? h('div', { className: 'bgx-label' }, '还没有任务。加一条，Bot 发言时会看到它。')
                    : (group.tasks || []).map(function (task) {
                        return h(
                          'div',
                          { key: task.id, className: 'bgx-task', 'data-done': task.status === 'done' ? 'true' : 'false' },
                          h('input', {
                            type: 'checkbox',
                            checked: task.status === 'done',
                            onChange: function () { taskCall({ taskId: task.id, status: task.status === 'done' ? 'todo' : 'done' }) },
                          }),
                          h(
                            'span',
                            { className: 'bgx-task-title', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                            task.title,
                          ),
                          h('button', { className: 'bgx-linkbtn', onClick: function () { taskCall({ taskId: task.id, remove: true }) } }, '删除'),
                        )
                      }),
                  h(
                    'div',
                    { className: 'bgx-row', style: { gap: 6, marginTop: 6 } },
                    h('input', {
                      className: 'bgx-input',
                      placeholder: '新任务…',
                      value: taskDraft,
                      onChange: function (event) { setTaskDraft(event.target.value) },
                      onKeyDown: function (event) {
                        if (event.key === 'Enter' && taskDraft.trim()) {
                          taskCall({ title: taskDraft.trim() })
                          setTaskDraft('')
                        }
                      },
                    }),
                    h(
                      'button',
                      {
                        className: 'bgx-btn',
                        disabled: !taskDraft.trim(),
                        onClick: function () {
                          taskCall({ title: taskDraft.trim() })
                          setTaskDraft('')
                        },
                      },
                      '加',
                    ),
                  ),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'bgx-label', style: { marginBottom: 6 } }, '模型与预算'),
                  h(
                    'div',
                    { className: 'bgx-field' },
                    h('span', null, '模型'),
                    h(
                      'select',
                      {
                        className: 'bgx-input',
                        style: { flex: 1, minWidth: 0 },
                        value: (group.model && group.model.provider) || '',
                        onChange: function (event) {
                          var pid = event.target.value
                          var row = providerRows.find(function (item) { return item.id === pid })
                          groupCall('model', { provider: pid, model: row ? row.model || (row.models || [])[0] || '' : '' })
                        },
                      },
                      h('option', { value: '' }, '跟随 Bot'),
                      providerRows
                        .filter(function (row) { return row.enabled })
                        .map(function (row) { return h('option', { key: row.id, value: row.id }, row.label) }),
                    ),
                  ),
                  group.model && group.model.model
                    ? h('div', { className: 'bgx-label', style: { marginLeft: 70, marginBottom: 4 } }, group.model.provider + ' / ' + group.model.model)
                    : null,
                  h(
                    'div',
                    { className: 'bgx-field' },
                    h('span', null, '每日上限'),
                    h('input', {
                      className: 'bgx-input',
                      style: { width: 76 },
                      type: 'number',
                      min: 0,
                      step: '0.5',
                      value: group.budget && group.budget.dailyCny != null ? group.budget.dailyCny : '',
                      placeholder: '不限',
                      onChange: function (event) {
                        setDetail(
                          Object.assign({}, group, {
                            budget: Object.assign({}, group.budget, {
                              dailyCny: event.target.value === '' ? null : Number(event.target.value),
                            }),
                          }),
                        )
                      },
                      onBlur: function (event) {
                        groupCall('budget', { dailyCny: event.target.value === '' ? null : Number(event.target.value) })
                      },
                    }),
                    h('span', { className: 'bgx-label' }, '今日已花 ' + (fmtCost(group.budget && group.budget.spentDay) || '¥0')),
                  ),
                ),
                h(
                  'div',
                  null,
                  h('div', { className: 'bgx-label', style: { marginBottom: 6 } }, '群设置'),
                  h('input', {
                    className: 'bgx-input',
                    value: group.name,
                    onChange: function (event) { setDetail(Object.assign({}, group, { name: event.target.value })) },
                    onBlur: function (event) { if (event.target.value.trim()) patchGroup({ name: event.target.value }) },
                  }),
                  h('input', {
                    className: 'bgx-input',
                    style: { marginTop: 6 },
                    value: group.topic || '',
                    placeholder: '群主题',
                    onChange: function (event) { setDetail(Object.assign({}, group, { topic: event.target.value })) },
                    onBlur: function (event) { patchGroup({ topic: event.target.value }) },
                  }),
                  h(
                    'div',
                    { className: 'bgx-row', style: { marginTop: 8, justifyContent: 'space-between' } },
                    h('button', { className: 'bgx-btn', onClick: function () { patchGroup({ archived: !group.archived }) } }, group.archived ? '取消归档' : '归档'),
                    h('button', { className: 'bgx-btn', 'data-kind': 'danger', onClick: removeGroup }, '解散群'),
                  ),
                  h(
                    'div',
                    { className: 'bgx-label', style: { marginTop: 10, lineHeight: 1.7 } },
                    '累计 ' + ((group.stats && group.stats.messages) || 0) + ' 条 · ' + ((group.stats && group.stats.botMessages) || 0) + ' 条 Bot 发言 · 花费 ' + (fmtCost(group.stats && group.stats.costCny) || '¥0'),
                  ),
                ),
              )
            : null,
          modal === 'create'
            ? h(CreateGroupDialog, {
                bots: bots,
                onClose: function () { setModal(null) },
                onCreated: function (created) {
                  setModal(null)
                  setSelectedId(created.id)
                  setDetail(created)
                  overview.reload()
                },
              })
            : null,
          modal === 'invite' && group
            ? h(InviteDialog, {
                bots: bots,
                existing: members.map(function (member) { return member.botId }),
                onClose: function () { setModal(null) },
                onInvite: invite,
              })
            : null,
        )
      }

      function InviteDialog(props) {
        var selectedState = useState([])
        var selected = selectedState[0]
        var setSelected = selectedState[1]
        var candidates = (props.bots || []).filter(function (bot) { return props.existing.indexOf(bot.id) < 0 })
        return h(
          'div',
          { className: 'bgx-dialog-mask', onMouseDown: function (event) { if (event.target === event.currentTarget) props.onClose() } },
          h(
            'div',
            { className: 'bgx-dialog', style: { width: 'min(460px,92vw)' } },
            h(
              'div',
              { className: 'bgx-row', style: { padding: '12px 14px', borderBottom: '1px solid ' + T.border, justifyContent: 'space-between' } },
              h('div', { style: { fontWeight: 600, fontSize: 14 } }, '邀请 Bot 进群'),
              h('button', { className: 'bgx-btn', onClick: props.onClose }, '关闭'),
            ),
            h(
              'div',
              { className: 'bgx-scroll', style: { padding: 14, display: 'flex', flexWrap: 'wrap', gap: 6 } },
              candidates.length === 0
                ? h('div', { className: 'bgx-label' }, '所有 Bot 都已经在这个群里了。')
                : candidates.map(function (bot) {
                    return h(
                      'button',
                      {
                        key: bot.id,
                        className: 'bgx-chip',
                        'data-on': selected.indexOf(bot.id) >= 0 ? 'true' : 'false',
                        onClick: function () {
                          setSelected(function (current) {
                            return current.indexOf(bot.id) >= 0 ? current.filter(function (id) { return id !== bot.id }) : current.concat([bot.id])
                          })
                        },
                        title: bot.role || bot.id,
                      },
                      h(MemberAvatar, { name: bot.name, size: 18 }),
                      h('span', null, bot.name),
                    )
                  }),
            ),
            h(
              'div',
              { className: 'bgx-row', style: { padding: '10px 14px', borderTop: '1px solid ' + T.border, justifyContent: 'flex-end' } },
              h('button', { className: 'bgx-btn', onClick: props.onClose }, '取消'),
              h('button', { className: 'bgx-btn', 'data-kind': 'primary', disabled: selected.length === 0, onClick: function () { props.onInvite(selected) } }, '邀请'),
            ),
          ),
        )
      }

      /* ------------------------------ 输入框快捷条 --------------------------- */
      function Dock(props) {
        var ctx = props.ctx
        var overview = useOverview(15000)
        var data = overview.data
        var groups = ((data && data.groups) || []).filter(function (group) { return !group.archived })
        var unread = groups.reduce(function (sum, group) { return sum + (group.unread || 0) }, 0)
        var openPanel = function () {
          try {
            ctx.layout.selectPanel('bot-groups')
          } catch (error) {
            bus.emit({ type: 'open' })
          }
        }
        return h(
          'div',
          { className: 'bgx-dock' },
          h(
            'button',
            { className: 'bgx-chip', onClick: openPanel, title: '打开 Bot 群面板' },
            h('span', { style: { fontWeight: 600 } }, 'Bot 群'),
            unread > 0 ? h('span', { className: 'bgx-dot' }) : null,
          ),
          groups.slice(0, 4).map(function (group) {
            return h(
              'button',
              {
                key: group.id,
                className: 'bgx-chip',
                onClick: function () {
                  bus.emit({ type: 'select', id: group.id })
                  openPanel()
                },
                title: (group.topic || group.name) + ' · ' + group.members.length + ' 位成员',
              },
              h(MemberAvatar, { name: group.avatar || group.name, size: 15, color: hashColor(group.name) }),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 } }, group.name),
              group.running ? h('span', { className: 'bgx-dot bgx-pulse' }) : group.unread > 0 ? h('span', { className: 'bgx-dot' }) : null,
            )
          }),
          h(
            'button',
            {
              className: 'bgx-chip',
              onClick: function () {
                bus.emit({ type: 'create' })
                openPanel()
              },
              title: '拉一个新群',
            },
            '+ 拉群',
          ),
        )
      }

      /* ----------------------------- 设置卡片 ------------------------------- */
      function SettingsCard(props) {
        var ctx = props.ctx
        var overview = useOverview(20000)
        var data = overview.data
        var diag = data && data.diag
        return h(
          'div',
          { className: 'bgx-root', style: { gap: 10, padding: 4 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Bot 群'),
          h(
            'div',
            { className: 'bgx-label', style: { lineHeight: 1.8 } },
            'Bot 群把多个 Bot 拉进一个群，用 @ 交接、圆桌讨论和群目标协作。它复用 dsh-bot 的 Bot 与运行记录，数据在 ',
            h('span', { className: 'bgx-mono' }, (diag && diag.homeDir) || '~/.dsh/bot'),
            '。',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h(
              'button',
              {
                className: 'bgx-btn',
                onClick: function () {
                  try {
                    ctx.layout.selectPanel('bot-groups')
                  } catch (error) {
                    bus.emit({ type: 'open' })
                  }
                },
              },
              '打开 Bot 群面板',
            ),
            h('button', { className: 'bgx-btn', onClick: function () { bus.emit({ type: 'create' }) } }, '拉个群'),
          ),
          diag
            ? h(
                'div',
                { className: 'bgx-label', style: { lineHeight: 1.8, borderTop: '1px solid ' + T.border, paddingTop: 8 } },
                '运行时：' + (diag.degraded ? '降级' : '就绪') + (diag.module ? '（' + diag.module + '）' : ''),
                h('br'),
                '群数量：' + (diag.groupCount || 0),
                h('br'),
                '自动接力：' + (diag.handoffEnabled ? '开启' : '关闭') + ' · 默认演练：' + (diag.dryRun ? '是' : '否'),
              )
            : null,
        )
      }

      /* --------------------------- 模型服务商设置 --------------------------- */
      function ProvidersCard(props) {
        var listState = useState(null)
        var payload = listState[0]
        var setPayload = listState[1]
        var editingState = useState(null)
        var editing = editingState[0]
        var setEditing = editingState[1]
        var formState = useState({})
        var form = formState[0]
        var setForm = formState[1]
        var busyState = useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var messageState = useState('')
        var message = messageState[0]
        var setMessage = messageState[1]

        var load = useCallback(
          function () {
            return api('/providers')
              .then(function (value) {
                setPayload(value)
                return value
              })
              .catch(function (error) {
                setMessage(error.message || String(error))
                return null
              })
          },
          [setPayload, setMessage],
        )

        useEffect(
          function () {
            load()
          },
          [load],
        )

        var rows = (payload && payload.providers) || []
        var presets = (payload && payload.presets) || []

        function startEdit(row) {
          setEditing(row.id)
          setMessage('')
          setForm({
            id: row.id,
            label: row.label,
            api: row.api,
            baseUrl: row.baseUrl,
            model: row.model || (row.models || [])[0] || '',
            models: (row.models || []).join(', '),
            keyRef: '',
            noKey: Boolean(row.noKey),
            enabled: row.configured ? row.enabled : true,
          })
        }

        function startCustom() {
          var id = window.prompt('自定义服务商的 ID（2-41 位字母/数字/下划线/短横线）', 'my-gateway')
          if (!id) return
          setEditing(String(id).trim())
          setMessage('')
          setForm({ id: String(id).trim(), label: String(id).trim(), api: 'openai', baseUrl: '', model: '', models: '', keyRef: '', noKey: false, enabled: true, custom: true })
        }

        function save() {
          setBusy(true)
          setMessage('')
          var body = {
            id: editing,
            label: form.label || editing,
            api: form.api,
            baseUrl: form.baseUrl,
            model: form.model,
            models: String(form.models || '')
              .split(',')
              .map(function (item) { return item.trim() })
              .filter(Boolean),
            noKey: Boolean(form.noKey),
            enabled: form.enabled !== false,
            custom: Boolean(form.custom),
          }
          if (form.keyRef) body.keyRef = form.keyRef
          api('/providers', { method: 'POST', body: body })
            .then(function (value) {
              setPayload({ providers: value.providers, presets: presets })
              setEditing(null)
              setMessage('已保存。新配置从下一轮发言开始生效。')
            })
            .catch(function (error) { setMessage(error.message || String(error)) })
            .finally(function () { setBusy(false) })
        }

        function testProviderRow(id) {
          setBusy(true)
          setMessage('正在测试 ' + id + ' …')
          api('/providers/' + encodeURIComponent(id) + '/test', { method: 'POST', body: {} })
            .then(function (result) {
              setPayload({ providers: result.providers || rows, presets: presets })
              setMessage(
                result.ok
                  ? id + ' 可用（' + result.via + '，' + result.latencyMs + 'ms，模型 ' + (result.models || []).length + ' 个）'
                  : id + ' 不可用：' + result.error,
              )
            })
            .catch(function (error) { setMessage(error.message || String(error)) })
            .finally(function () { setBusy(false) })
        }

        function removeProvider(id) {
          if (!window.confirm('删除服务商 ' + id + ' 的本地配置？')) return
          setBusy(true)
          api('/providers/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(function (value) { setPayload({ providers: value.providers, presets: presets }) })
            .catch(function (error) { setMessage(error.message || String(error)) })
            .finally(function () { setBusy(false) })
        }

        var list = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          rows.map(function (row) {
            return h(
              'div',
              { key: row.id, className: 'bgx-row', style: { justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid ' + T.border } },
              h(
                'div',
                { style: { minWidth: 0 } },
                h(
                  'div',
                  { className: 'bgx-row', style: { gap: 6 } },
                  h('span', { style: { fontSize: 12.5, fontWeight: 550 } }, row.label),
                  row.configured ? h('span', { className: 'bgx-pill', style: { color: row.enabled ? T.ok : T.text3 } }, row.enabled ? '启用' : '停用') : null,
                  row.hasKey ? h('span', { className: 'bgx-label' }, 'key：' + row.keySource) : h('span', { className: 'bgx-label', style: { color: T.warn } }, '未配置 key'),
                  row.custom ? h('span', { className: 'bgx-pill' }, '自定义') : null,
                ),
                h(
                  'div',
                  { className: 'bgx-label', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  row.api + ' · ' + row.baseUrl + ' · ' + ((row.models || [])[0] || '未指定模型'),
                ),
              ),
              h(
                'div',
                { className: 'bgx-row', style: { gap: 4, flex: '0 0 auto' } },
                h('button', { className: 'bgx-btn', style: { height: 24, padding: '0 8px' }, onClick: function () { startEdit(row) } }, '配置'),
                row.configured ? h('button', { className: 'bgx-btn', style: { height: 24, padding: '0 8px' }, disabled: busy, onClick: function () { testProviderRow(row.id) } }, '测试') : null,
                row.configured ? h('button', { className: 'bgx-linkbtn', onClick: function () { removeProvider(row.id) } }, '删除') : null,
              ),
            )
          }),
        )

        var editor = editing
          ? h(
              'div',
              { style: { border: '1px solid ' + T.border, borderRadius: T.rSm, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 } },
              h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '配置：' + (form.label || editing)),
              h(
                'div',
                { className: 'bgx-field' },
                h('span', null, '接口'),
                h(
                  'select',
                  { className: 'bgx-input', value: form.api || 'openai', onChange: function (event) { setForm(Object.assign({}, form, { api: event.target.value })) } },
                  ['openai', 'anthropic', 'gemini'].map(function (api) { return h('option', { key: api, value: api }, api) }),
                ),
              ),
              h(
                'div',
                { className: 'bgx-field' },
                h('span', null, 'Base URL'),
                h('input', {
                  className: 'bgx-input',
                  placeholder: 'https://api.example.com/v1',
                  value: form.baseUrl || '',
                  onChange: function (event) { setForm(Object.assign({}, form, { baseUrl: event.target.value })) },
                }),
              ),
              h(
                'div',
                { className: 'bgx-field' },
                h('span', null, 'API Key'),
                h('input', {
                  className: 'bgx-input',
                  type: 'password',
                  placeholder: '留空表示沿用已保存的；也支持 env:MY_KEY',
                  value: form.keyRef || '',
                  onChange: function (event) { setForm(Object.assign({}, form, { keyRef: event.target.value })) },
                }),
              ),
              h(
                'div',
                { className: 'bgx-field' },
                h('span', null, '默认模型'),
                h('input', {
                  className: 'bgx-input',
                  placeholder: 'deepseek-chat / Qwen/Qwen3-235B-A22B-Instruct-2507',
                  value: form.model || '',
                  onChange: function (event) { setForm(Object.assign({}, form, { model: event.target.value })) },
                }),
              ),
              h(
                'div',
                { className: 'bgx-field' },
                h('span', null, '模型清单'),
                h('input', {
                  className: 'bgx-input',
                  placeholder: '用英文逗号分隔',
                  value: form.models || '',
                  onChange: function (event) { setForm(Object.assign({}, form, { models: event.target.value })) },
                }),
              ),
              h(
                'div',
                { className: 'bgx-row', style: { gap: 12 } },
                h(
                  'label',
                  { className: 'bgx-label', style: { display: 'flex', alignItems: 'center', gap: 4 } },
                  h('input', { type: 'checkbox', checked: form.noKey === true, onChange: function (event) { setForm(Object.assign({}, form, { noKey: event.target.checked })) } }),
                  '不需要 key（本地模型）',
                ),
                h(
                  'label',
                  { className: 'bgx-label', style: { display: 'flex', alignItems: 'center', gap: 4 } },
                  h('input', { type: 'checkbox', checked: form.enabled !== false, onChange: function (event) { setForm(Object.assign({}, form, { enabled: event.target.checked })) } }),
                  '启用',
                ),
              ),
              form.enabled === false ? null : h('div', { className: 'bgx-label' }, '保存后，Bot 面板里把 Bot 的模型切到这家服务商即可使用。'),
              h(
                'div',
                { className: 'bgx-row', style: { justifyContent: 'flex-end', gap: 6 } },
                h('button', { className: 'bgx-btn', onClick: function () { setEditing(null) } }, '取消'),
                h('button', { className: 'bgx-btn', 'data-kind': 'primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
              ),
            )
          : null

        return h(
          'div',
          { className: 'bgx-root', style: { gap: 10, padding: 4 } },
          h('div', { className: 'bgx-row', style: { justifyContent: 'space-between' } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, '模型服务商'),
            h('button', { className: 'bgx-btn', onClick: startCustom }, '+ 自定义服务商'),
          ),
          h(
            'div',
            { className: 'bgx-label', style: { lineHeight: 1.8 } },
            '在这里配置第三方模型 API（OpenAI / DeepSeek / Anthropic / Gemini / 通义百炼 / Kimi / 智谱 / 豆包 / 硅基流动 / OpenRouter / 魔搭社区 ModelScope / Ollama 本地），',
            '也支持任意 OpenAI 兼容端点。API Key 只保存在本机 ',
            h('span', { className: 'bgx-mono' }, (payload && payload.file) || '~/.dsh/bot/providers.json'),
            '。',
          ),
          message ? h('div', { className: 'bgx-label', style: { color: T.warn } }, message) : null,
          rows.length === 0 ? h('div', { className: 'bgx-label' }, '正在加载…') : list,
          editing ? editor : null,
          h('div', { className: 'bgx-label', style: { marginTop: 4, lineHeight: 1.7 } }, '提示：群发言默认走 Bot 自己的模型；在群的「模型与预算」里可以把整个群临时切到某家服务商。'),
          presets.length === 0
            ? null
            : h(
                'details',
                null,
                h('summary', { className: 'bgx-label', style: { cursor: 'pointer' } }, '查看内置预置（' + presets.length + ' 家）'),
                h(
                  'div',
                  { className: 'bgx-label', style: { lineHeight: 1.8, marginTop: 4 } },
                  presets.map(function (preset) {
                    return h('div', { key: preset.id }, preset.label + '（' + preset.id + '）：' + preset.api + ' · ' + preset.baseUrl + (preset.noKey ? ' · 无需 key' : ''))
                  }),
                ),
              ),
        )
      }

      /* -------------------------------- 事件总线 ----------------------------- */
      var bus = (function () {
        var listeners = new Set()
        var pending = []
        return {
          on: function (listener) {
            listeners.add(listener)
            while (pending.length > 0) {
              var event = pending.shift()
              try {
                listener(event)
              } catch (error) {
                /* 忽略 */
              }
            }
            return function () {
              listeners.delete(listener)
            }
          },
          emit: function (event) {
            if (listeners.size === 0) {
              if (pending.length < 8) pending.push(event)
              return
            }
            listeners.forEach(function (listener) {
              try {
                listener(event)
              } catch (error) {
                /* 忽略单个监听器错误 */
              }
            })
          },
        }
      })()

      /* 真正的错误边界：hooks 抛错发生在子组件里，try/catch 包不住，必须用类。 */
      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { error: null }
        }

        static getDerivedStateFromError(error) {
          return { error: error }
        }

        componentDidCatch(error) {
          console.error('[dsh-bot-groups] ' + this.props.label + ' 渲染失败', error)
        }

        render() {
          if (this.state.error) {
            var message = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)
            return h(
              'div',
              { style: { padding: 12, color: T.err, fontSize: 12 } },
              'Bot 群组件出错：' + message,
            )
          }
          return this.props.children
        }
      }

      function wrap(name, render) {
        function Guarded(props) {
          return h(ErrorBoundary, { label: name }, render(props))
        }
        Guarded.displayName = 'dsh-bot-groups-' + name
        return Guarded
      }

      /** 侧边栏入口图标：两个叠在一起的对话气泡，表示「Bot 群」。 */
      function BotGroupsSidebarIcon(props) {
        var size = (props && props.size) || 16
        return h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2.6, y: 9, width: 11.2, height: 8.4, rx: 2.6, stroke: 'currentColor', strokeWidth: 1.6 }),
          h('path', { d: 'M7.2 17.4 V20.2 L10.6 17.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
          h('rect', { x: 10.1, y: 3.6, width: 11.3, height: 8.2, rx: 2.6, stroke: 'currentColor', strokeWidth: 1.6, fill: 'var(--dsw-alias-bg-base)' }),
        )
      }

      var inject = ['slots', 'layout']

      function apply(ctx) {
        try {
          ensureStyle()
        } catch (error) {
          console.warn('[dsh-bot-groups] 注入样式失败', error)
        }

        var Panel = wrap('panel', function () { return h(Shell, { ctx: ctx }) })
        var DockBar = wrap('dock', function () { return h(Dock, { ctx: ctx }) })
        var Settings = wrap('settings', function () { return h(SettingsCard, { ctx: ctx }) })
        var Providers = wrap('providers', function () { return h(ProvidersCard, { ctx: ctx }) })

        safeRegister(ctx, 'main', { name: 'main', key: 'bot-groups' }, Panel)
        safeRegister(ctx, 'conversation.input.dock', { name: 'conversation.input.dock', id: 'bot-groups', order: 21 }, DockBar)
        safeRegister(ctx, 'settings.section', { name: 'settings.section', id: 'bot-groups', order: 610, label: function () { return 'Bot 群' } }, Settings)
        safeRegister(ctx, 'settings.section', { name: 'settings.section', id: 'bot-providers', order: 611, label: function () { return '模型服务商' } }, Providers)
        safeRegister(ctx, 'sidebar.panellist', { name: 'sidebar.panellist', id: 'bot-groups', order: 41, label: function () { return 'Bot 群' } }, BotGroupsSidebarIcon)
      }

      function safeRegister(ctx, slot, options, component) {
        try {
          ctx.slots.inject(slot, function () {
            return ctx.slots.register(options, component)
          })
        } catch (error) {
          console.warn('[dsh-bot-groups] 注册插槽 ' + slot + ' 失败', error)
        }
      }

      return {
        name: 'dsh-bot-groups-client',
        inject: inject,
        apply: apply,
        /* 仅用于调试 / 自测：DSH 加载器会忽略多余字段。 */
        __components: {
          Shell: Shell,
          Dock: Dock,
          SettingsCard: SettingsCard,
          ProvidersCard: ProvidersCard,
          MessageRow: MessageRow,
          CreateGroupDialog: CreateGroupDialog,
          InviteDialog: InviteDialog,
          MemberAvatar: MemberAvatar,
          api: api,
        },
      }
    },
  })
})()

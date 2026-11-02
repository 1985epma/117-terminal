import { useEffect, useState } from 'react'

// Settings › Web & HarmonyOS: serve this app to a browser without the CLI.
export default function WebSection() {
  const [status, setStatus] = useState(null)
  const [port, setPort] = useState(7117)
  const [network, setNetwork] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const inBrowser = window.eterm.platform === 'web'

  useEffect(() => {
    window.eterm.serve.status().then((s) => {
      setStatus(s)
      if (s.port) setPort(s.port)
      if (s.network) setNetwork(true)
    })
  }, [])

  const act = async (fn) => {
    setBusy(true)
    setStatus(await fn())
    setBusy(false)
  }
  const copy = (url) => {
    window.eterm.clipboard.write(url)
    setCopied(url)
    setTimeout(() => setCopied(''), 1500)
  }

  const Url = ({ label, url }) => (
    <div className="set-url">
      <span>{label}</span>
      <code>{url}</code>
      <button onClick={() => copy(url)}>{copied === url ? 'Copied' : 'Copy'}</button>
      <button onClick={() => window.eterm.openExternal(url)}>Open</button>
    </div>
  )

  return (
    <div className="set-section">
      <h2>Web &amp; HarmonyOS</h2>
      <p className="set-hint">
        Use 117Terminal from any browser: a HarmonyOS tablet or phone, another computer, or this Mac. The shell, agent and
        music keep running on this machine.
      </p>

      {inBrowser || status?.mode === 'serve' ? (
        <div className="set-note">You are using web mode right now. Stop it with Ctrl+C where you ran <code>117terminal --serve</code>.</div>
      ) : (
        <>
          <div className="set-row">
            <div>
              <b>Port</b>
              <small>Default 7117</small>
            </div>
            <input
              className="set-port"
              type="number"
              min="1024"
              max="65535"
              value={port}
              disabled={status?.running}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
          <label className="set-row">
            <div>
              <b>Allow other devices on my network</b>
              <small>Needed for a HarmonyOS tablet or phone. Anyone with the link gets a shell here: share it only with your own devices.</small>
            </div>
            <input type="checkbox" checked={network} disabled={status?.running} onChange={(e) => setNetwork(e.target.checked)} />
          </label>

          <div className="set-buttons">
            {status?.running ? (
              <button className="danger" disabled={busy} onClick={() => act(() => window.eterm.serve.stop())}>
                Stop web mode
              </button>
            ) : (
              <button className="primary" disabled={busy} onClick={() => act(() => window.eterm.serve.start({ port, network }))}>
                Start web mode
              </button>
            )}
            {status?.running && <span className="set-live">● running</span>}
          </div>
          {status?.error && <div className="set-note bad">{status.error}</div>}

          {status?.running && (
            <div className="set-urls">
              <Url label="This computer" url={status.url} />
              {status.lanUrl && <Url label="Other devices" url={status.lanUrl} />}
              {status.network && !status.lanUrl && <div className="set-note">No network address found. Is Wi-Fi on?</div>}
              <p className="set-hint">
                The link carries a one-time access token. Stopping web mode closes open browser tabs and their shells. Voice in
                the browser works on this computer only (browsers block the mic on plain http from other devices).
              </p>
            </div>
          )}
        </>
      )}

      <h2 className="set-sub">From the command line</h2>
      <pre className="set-code">{`117terminal --serve                  # this computer
117terminal --serve --host 0.0.0.0   # other devices on your network
117terminal --serve --port 8080 --open`}</pre>
      <p className="set-hint">
        On a HarmonyOS PC, run the Linux arm64 build inside its Linux environment with <code>--serve --no-sandbox</code> and open
        the link in the HarmonyOS browser.
      </p>
    </div>
  )
}

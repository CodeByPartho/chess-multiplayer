// Thin wrapper around the Stockfish WASM build, running in a Web Worker.
// Speaks UCI: https://www.chessprogramming.org/Universal_Chess_Interface

const ENGINE_PATH = '/engine/stockfish-19-lite-single.js'

const line = (e) => (typeof e.data === 'string' ? e.data : '')

export function createEngine() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(ENGINE_PATH)
    worker.addEventListener('error', (e) => reject(new Error(e.message)), { once: true })
    worker.addEventListener('message', function onMessage(e) {
      const text = line(e)
      if (text === 'uciok') {
        worker.postMessage('isready')
      } else if (text === 'readyok') {
        worker.removeEventListener('message', onMessage)
        resolve(makeApi(worker))
      }
    })
    worker.postMessage('uci')
  })
}

function makeApi(worker) {
  return {
    /** @returns {Promise<{bestmove: string}>} */
    analyze(fen, depth = 12) {
      return new Promise((resolve) => {
        worker.addEventListener('message', function onMessage(e) {
          const text = line(e)
          if (text.startsWith('bestmove')) {
            worker.removeEventListener('message', onMessage)
            resolve({ bestmove: text.split(' ')[1] })
          }
        })
        worker.postMessage(`position fen ${fen}`)
        worker.postMessage(`go depth ${depth}`)
      })
    },
    stop() {
      worker.postMessage('stop')
    },
    quit() {
      worker.postMessage('quit')
      worker.terminate()
    },
  }
}

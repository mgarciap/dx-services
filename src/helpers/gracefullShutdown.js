const info = require('debug')('INFO-dx-service:helpers:gratefullShutdown')
const POSIX_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT']
const listerners = []

POSIX_SIGNALS.forEach(signal => {
  process.on(signal, () => {
    function exit (returnCode) {
      info('The app is ready to shutdown! Good bye! :)')
      process.exit(returnCode)
    }

    shutDown(signal)
      .then(() => {
        exit(0)
      })
      .catch(error => {
        info('Error shuttting down the app: ' + error.toString())
        console.error(error)
        exit(2)
      })
  })
})

function onShutdown (listener) {
  // debug('Registering a new listener')
  listerners.push(listener)
}

async function shutDown (signal) {
  if (signal) {
    info("I've gotten a %o signal! Closing gracefully...", signal)
  }

  // Wait for all shutdow listeners
  await Promise.all(
    listerners.map(listener => {
      return listener()
    })
  )
}

module.exports = {
  shutDown,
  onShutdown
}

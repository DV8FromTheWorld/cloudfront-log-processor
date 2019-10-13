const ipRegex = /([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/
const getIpDigits = (ip) => {
  const digits = ipRegex.exec(ip)
  if (!digits) {
    return null
  }

  return ipRegex.exec(ip).splice(1).map(stringDigit => +stringDigit)
}

const ipIsInKnownRange = (log, ranges) => {
  const ipDigits = getIpDigits(log)
  if (!ipDigits) {
    return false
  }

  return ranges.some(([start, end]) => {
    return start.every((digit, digitIdx) => ipDigits[digitIdx] >= digit)
      && end.every((digit, digitIdx) => ipDigits[digitIdx] <= digit)
  })
}

module.exports = {
  getIpDigits,
  ipIsInKnownRange
}
const fs         = require('fs')
const fsPromises = fs.promises
const path       = require('path')
const process    = require('process')

const { ungzip } = require('node-gzip')
const yargs      = require('yargs')

const { safeAppend, ensureDirExists }   = require('./utils/fs-utils')
const { getIpDigits, ipIsInKnownRange } = require('./utils/ip-utils')

const GZIP_FOLDER = path.resolve('./gzip')
const CSV_FOLDER = path.resolve('./csv')

const columnsRegex = /#Fields: (.*)/

const getArgAsArray = (argv, argName) => {
  const argVal = argv[argName]
  if (argVal === undefined) {
    return null
  }

  return Array.isArray(argVal) ? argVal : [argVal]
}

async function gzipToCsv(argv) {
  await ensureDirExists(GZIP_FOLDER)
  await ensureDirExists(CSV_FOLDER)

  const gzipFiles = await fsPromises.readdir(GZIP_FOLDER)
  const csvFiles = await Promise.all(gzipFiles.map(async gzipFile => {
    const srcPath = path.resolve(GZIP_FOLDER, gzipFile)
    const destPath = path.resolve(CSV_FOLDER, gzipFile.replace(".gz", ".csv"))

    const gzipContent = await fsPromises.readFile(srcPath)
    const rawContent = String(await ungzip(gzipContent))

    //Skip the very first line as it is garbage info
    const lines = rawContent.split('\n').splice(1)

    //Columns are #Fields: col1 col2 col3 ... etc
    //Remove the #Fields: and then change to comma delimited
    const columns = columnsRegex.exec(lines[0])[1].replace(/ /g, ',')

    //Rows are tab delimited.
    const rows = lines.splice(1)
      .map(line => line.replace(/\t/g, ','))
      .filter(line => !!line)

    const csvContent = `${columns}\n${rows.join('\n')}`

    await fsPromises.writeFile(destPath, csvContent)

    return destPath
  }))

  console.log(`done converting ${csvFiles.length} file${csvFiles.length > 1 ? 's' : ''} to .csv`)

  return csvFiles
}

async function combineCsvFiles(argv, csvFiles) {
  await ensureDirExists(CSV_FOLDER)

  if (!csvFiles) {
    csvFiles = await fsPromises.readdir(CSV_FOLDER)
  }

  //Filters that restrict what logs get added to the unified log.
  const logFilters = []

  const ipRanges = getArgAsArray(argv, 'ip-range')
  if (ipRanges) {
    console.log("Filtering logs by ip-ranges:")
    const ranges = ipRanges
      .map(rawRange => {
        const rangeParts = rawRange.split(',')
        console.log(` - [${rangeParts[0]} - ${rangeParts[1]}]`)

        const [start, end] = rangeParts.map(getIpDigits)

        if (!start || !end) {
          console.error(`Failed to parse --ip-range of '${rawRange}'`)
          process.exit(1)
        }

        return [start, end]
      })

    logFilters.push(log => ipIsInKnownRange(log, ranges))
  }

  const filters = getArgAsArray(argv, 'filter')
  if (filters) {
    console.log("Filtering logs by terms:")
    filters.forEach(filterTerm => console.log(` - '${filterTerm}'`))

    logFilters.push(log => filters.some(filterText => log.includes(filterText)))
  }

  const destFile = path.resolve(`logs.${Date.now()}.csv`)
  let setColumnNamesLine = false
  let totalFilteredOutLogs = 0

  //Use a for-each loop instad of a Promise.all(arr.map) so that each append happens sequentially instead of possibly
  // overwriting eachother
  for (const csvFile of csvFiles) {
    const srcPath = path.resolve(CSV_FOLDER, csvFile)
    const csvContent = String(await fsPromises.readFile(srcPath))
    const csvLines = csvContent.split('\n')
    
    //Save the columnLine
    if (!setColumnNamesLine) {
      await safeAppend(destFile, csvLines[0])
      setColumnNamesLine = true
    }

    const totalLogs = csvLines.length - 1 //Don't include the header in total logs
    const filteredLogs = csvLines.splice(1).filter(log => logFilters.every(filter => filter(log)))
    totalFilteredOutLogs += totalLogs - filteredLogs.length

    await safeAppend(destFile, `${filteredLogs.join('\n')}\n`)
  }

  console.log(`Filtered out ${totalFilteredOutLogs} logs.`)
  console.log(`Combined all CSV files into '${destFile}'`)
}

async function createLog(argv) {
  const csvFiles = await gzipToCsv(argv)
  await combineCsvFiles(argv, csvFiles)
}

function attachCsvFilterFlagInfo(yargs) {
  yargs.option('f', {
    alias: 'filter',
    describe: 'Filter by specific search terms.',
    type: 'string'
  })

  yargs.option('ip', {
    alias: 'ip-range',
    describe: 'specialized form of --filter specifically meant to filter by ip-address ranges',
    type: 'string'
  })

  yargs.example('$0 create-log')
  yargs.example('$0 create-log --filter POST --filter GET')
  yargs.example(`$0 create-log --filter /todos --ip-range 10.0.23.2,10.2.0.254`)
  yargs.example('$0 create-log --ip-range 10.0.23.2,10.2.0.254 --ip-range 10.18.77.0,10.12.77.4')
}

const argv = yargs
  .usage('Usage: $0 <command> [flags]')
  .wrap(yargs.terminalWidth())
  .version()
  .command({
    command: 'to-csv',
    desc: 'Converts all .gz files in the ./gzip folder to .csv files in the ./csv folder',
    handler: gzipToCsv
  })
  .command({
    command: 'combine-csv',
    desc: `Combines all .csv files in ./csv into a single .csv file in the root directory.`,
    handler: combineCsvFiles,
    builder: attachCsvFilterFlagInfo
  })
  .command({
    command: 'create-log',
    desc: `Creates a unified .csv log file from the .gz files in ./gzip (combo of 'to-csv' and 'combine-csv').`,
    handler: createLog,
    builder: attachCsvFilterFlagInfo
  })
  .help()
  .strict()
  .argv

if (!argv._[0]) {
  yargs.showHelp()
}

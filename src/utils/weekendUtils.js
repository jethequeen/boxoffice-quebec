/**
 * Calculate the weekend ID based on the last Friday from today
 * Weekend ID format: WWYYY where WW is week number and YYYY is year
 * Example: 282025 = Week 28 of 2025
 */
export const getCurrentWeekendId = () => {
  const today = new Date()
  const lastFriday = getLastFriday(today)
  
  // Get the year
  const year = lastFriday.getFullYear()
  
  // Calculate week number (week of the year)
  const weekNumber = getWeekNumber(lastFriday)
  
  // Format as WWYYY (2-digit week + 4-digit year)
  return `${weekNumber.toString().padStart(2, '0')}${year}`
}

/**
 * Get the last Friday from a given date
 */
const getLastFriday = (date) => {
  const now = new Date(date)
  const day = now.getDay() // 0 = Sunday, 1 = Monday, ..., 5 = Friday
  const hour = now.getHours()

  // Step 1: Calculate base last Friday
  const base = new Date(now)
  let daysToSubtract = (day >= 5) ? day - 5 : day + 2
  base.setDate(now.getDate() - daysToSubtract)

  // Step 2: Adjust if in the "late weekend window"
  const isLateWeekendWindow =
      (day === 5 || day === 6 || day === 0) || // Friday, Saturday, Sunday
      (day === 1 && hour < 15)                 // Monday before 3PM

  if (isLateWeekendWindow) {
    base.setDate(base.getDate() - 7) // Go back an additional week
  }

  return base
}


/**
 * Get the week number of the year for a given date
 * Uses ISO week numbering
 */
const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

/**
 * Format weekend ID for display
 * Example: 282025 -> "Week 28, 2025"
 */
export const formatWeekendId = (weekendId) => {
  if (!weekendId) return 'N/A'
  
  const str = weekendId.toString()
  const year = str.slice(-4)
  const week = str.slice(0, -4)
  
  return `Week ${parseInt(week)}, ${year}`
}

/**
 * Parse weekend ID to get week and year
 * Example: 282025 -> { week: 28, year: 2025 }
 */
export const parseWeekendId = (weekendId) => {
  if (!weekendId) return null
  
  const str = weekendId.toString()
  const year = parseInt(str.slice(-4))
  const week = parseInt(str.slice(0, -4))
  
  return { week, year }
}

/**
 * Get the date of Friday for a given weekend ID
 */
export const getFridayFromWeekendId = (weekendId) => {
  const { week, year } = parseWeekendId(weekendId)
  if (!week || !year) return null

  // Get first day of the year
  const firstDay = new Date(year, 0, 1)

  // Calculate the date of the first Friday of the year
  const firstFriday = new Date(firstDay)
  const dayOfWeek = firstDay.getDay()
  const daysToFirstFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 12 - dayOfWeek
  firstFriday.setDate(firstDay.getDate() + daysToFirstFriday)

  // Add weeks to get to the target week
  const targetFriday = new Date(firstFriday)
  targetFriday.setDate(firstFriday.getDate() + (week - 1) * 7)

  return targetFriday
}

/**
 * Get the previous weekend ID
 */
export const getPreviousWeekendId = (weekendId) => {
  const { week, year } = parseWeekendId(weekendId)
  if (!week || !year) return null

  let prevWeek = week - 1
  let prevYear = year

  if (prevWeek <= 0) {
    prevYear -= 1
    prevWeek = 52 // Approximate, could be 53 in some years
  }

  return `${prevWeek.toString().padStart(2, '0')}${prevYear}`
}

/**
 * Get the next weekend ID
 */
export const getNextWeekendId = (weekendId) => {
  const { week, year } = parseWeekendId(weekendId)
  if (!week || !year) return null

  let nextWeek = week + 1
  let nextYear = year

  if (nextWeek > 52) {
    nextYear += 1
    nextWeek = 1
  }

  return `${nextWeek.toString().padStart(2, '0')}${nextYear}`
}

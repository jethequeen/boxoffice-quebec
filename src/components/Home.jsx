import WeekendDetails from './WeekendDetails'
import { getCurrentWeekendId } from '../utils/weekendUtils'

function Home() {
  // Calculate current weekend ID based on last Friday
  const currentWeekendId = getCurrentWeekendId()
  
  // Home page shows current weekend details
  return <WeekendDetails weekendId={currentWeekendId} />
}

export default Home

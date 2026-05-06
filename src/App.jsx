import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import InventoryDashboard from './components/InventoryDashboard'
import WeekendDetails from './components/WeekendDetails'
import DailyDetails from './components/DailyDetails'
import Movies from './components/Movies'
import MovieDetails from './components/MovieDetails'
import GenreDetails from './components/GenreDetails'
import CrewDetails from './components/CrewDetails'
import './App.css'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<InventoryDashboard />} />
          <Route path="/box-office" element={<WeekendDetails showNavigation={true} />} />
          <Route path="/box-office/:weekendId" element={<WeekendDetails showNavigation={true} />} />
          <Route path="/weekend/:weekendId" element={<WeekendDetails />} />
          <Route path="/daily/:date" element={<DailyDetails />} />
          <Route path="/movies" element={<Movies />} />
          <Route path="/movies/:id" element={<MovieDetails />} />
          <Route path="/genres/:id" element={<GenreDetails />} />
          <Route path="/crew/:id" element={<CrewDetails />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App

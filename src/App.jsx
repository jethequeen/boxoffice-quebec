import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Movies from './components/Movies'
import MovieDetails from './components/MovieDetails'
import Directors from './components/Directors'
import GenreDetails from './components/GenreDetails'
import CrewDetails from './components/CrewDetails'
import Blog from './components/Blog'
import BlogPost from './components/BlogPost'
import './App.css'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/movies" element={<Movies />} />
          <Route path="/movies/:id" element={<MovieDetails />} />
          <Route path="/directors" element={<Directors />} />
          <Route path="/genres/:id" element={<GenreDetails />} />
          <Route path="/crew/:id" element={<CrewDetails />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App

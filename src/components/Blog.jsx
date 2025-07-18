import { Link } from 'react-router-dom'
import './Blog.css'

function Blog() {

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  return (
    <div className="blog">
      <div className="blog-header">
        <h1>Blog</h1>
        <p>Analyses, tendances et insights sur le box-office québécois</p>
      </div>

      <div className="blog-posts">
        {blogPosts.map((post) => (
          <article key={post.id} className="blog-post-card">
            <div className="post-meta">
              <span className="post-category">{post.category}</span>
              <span className="post-date">{formatDate(post.date)}</span>
            </div>
            
            <h2 className="post-title">
              <Link to={`/blog/${post.id}`}>{post.title}</Link>
            </h2>
            
            <p className="post-excerpt">{post.excerpt}</p>
            
            <div className="post-footer">
              <div className="post-author">
                <span className="author-icon">👤</span>
                <span>{post.author}</span>
              </div>
              <div className="post-read-time">
                <span className="time-icon">⏱️</span>
                <span>{post.readTime}</span>
              </div>
            </div>
            
            <Link to={`/blog/${post.id}`} className="read-more-btn">
              Lire l'article →
            </Link>
          </article>
        ))}
      </div>

      <div className="blog-sidebar">
        <div className="sidebar-section">
          <h3>Catégories</h3>
          <ul className="category-list">
            <li><a href="#" className="category-link">Analyses <span className="count">(12)</span></a></li>
            <li><a href="#" className="category-link">Classements <span className="count">(8)</span></a></li>
            <li><a href="#" className="category-link">Études <span className="count">(6)</span></a></li>
            <li><a href="#" className="category-link">Actualités <span className="count">(15)</span></a></li>
          </ul>
        </div>

        <div className="sidebar-section">
          <h3>Articles populaires</h3>
          <ul className="popular-posts">
            <li>
              <a href="#" className="popular-post-link">
                Les 5 films québécois qui ont surpris en 2024
              </a>
            </li>
            <li>
              <a href="#" className="popular-post-link">
                Comment analyser les données du box-office
              </a>
            </li>
            <li>
              <a href="#" className="popular-post-link">
                L'impact de Netflix sur le cinéma québécois
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Blog

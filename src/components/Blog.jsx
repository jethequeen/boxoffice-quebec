import { Link } from 'react-router-dom'
import './Blog.css'

function Blog() {
  // Mock blog posts data - in a real app, this would come from your database
  const blogPosts = [
    {
      id: 1,
      title: "L'évolution du cinéma québécois en 2024",
      excerpt: "Une analyse des tendances et performances du box-office québécois cette année, avec un focus sur les productions locales qui ont marqué le public.",
      date: "2024-12-15",
      author: "Équipe Box-Office Québec",
      readTime: "5 min",
      category: "Analyse"
    },
    {
      id: 2,
      title: "Top 10 des films québécois les plus rentables",
      excerpt: "Découvrez quels films québécois ont généré le plus de revenus au box-office et les facteurs qui ont contribué à leur succès commercial.",
      date: "2024-12-10",
      author: "Équipe Box-Office Québec",
      readTime: "7 min",
      category: "Classement"
    },
    {
      id: 3,
      title: "Impact des festivals sur le box-office",
      excerpt: "Comment les festivals de cinéma influencent-ils les performances commerciales des films québécois? Une étude approfondie des données.",
      date: "2024-12-05",
      author: "Équipe Box-Office Québec",
      readTime: "6 min",
      category: "Étude"
    }
  ]

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

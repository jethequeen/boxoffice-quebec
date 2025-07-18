import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import './BlogPost.css'

function BlogPost() {
  const { id } = useParams()



  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  if (!blogPost) {
    return (
      <div className="blog-post">
        <div className="error">
          <h2>Article non trouvé</h2>
          <p>L'article demandé n'existe pas ou a été supprimé.</p>
          <Link to="/blog" className="back-link">← Retour au blog</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="blog-post">
      <div className="blog-post-header">
        <Link to="/blog" className="back-link">← Retour au blog</Link>
        
        <div className="post-meta">
          <span className="post-category">{blogPost.category}</span>
          <span className="post-date">{formatDate(blogPost.date)}</span>
        </div>
        
        <h1 className="post-title">{blogPost.title}</h1>
        
        <div className="post-info">
          <div className="post-author">
            <span className="author-icon">👤</span>
            <span>{blogPost.author}</span>
          </div>
          <div className="post-read-time">
            <span className="time-icon">⏱️</span>
            <span>{blogPost.readTime}</span>
          </div>
        </div>
      </div>

      <div className="blog-post-content">
        <ReactMarkdown>{blogPost.content}</ReactMarkdown>
      </div>

      <div className="blog-post-footer">
        <div className="share-section">
          <h3>Partager cet article</h3>
          <div className="share-buttons">
            <button className="share-btn twitter">🐦 Twitter</button>
            <button className="share-btn facebook">📘 Facebook</button>
            <button className="share-btn linkedin">💼 LinkedIn</button>
          </div>
        </div>
        
        <Link to="/blog" className="back-to-blog">
          ← Voir tous les articles
        </Link>
      </div>
    </div>
  )
}

export default BlogPost

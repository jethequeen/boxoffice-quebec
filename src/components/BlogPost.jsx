import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import './BlogPost.css'

function BlogPost() {
  const { id } = useParams()

  // Mock blog post data - in a real app, this would be fetched from your database
  const blogPost = {
    id: parseInt(id),
    title: "L'évolution du cinéma québécois en 2024",
    content: `
# L'évolution du cinéma québécois en 2024

Le cinéma québécois a connu une année remarquable en 2024, marquée par des succès commerciaux inattendus et une diversification des genres qui ont captivé le public.

## Les chiffres clés de l'année

Cette année a été particulièrement fructueuse pour l'industrie cinématographique québécoise :

- **Augmentation de 15%** des recettes par rapport à 2023
- **23 films québécois** ont dépassé le million de dollars au box-office
- **Croissance de 28%** de la fréquentation des salles pour les productions locales

## Les tendances marquantes

### 1. Le retour de la comédie québécoise

Les comédies ont dominé le box-office québécois cette année, représentant 40% des recettes totales des films locaux. Cette renaissance s'explique par :

- Un retour aux valeurs familiales post-pandémie
- Des scénarios qui reflètent les préoccupations actuelles des Québécois
- Une production de qualité supérieure grâce aux nouvelles technologies

### 2. L'émergence du cinéma d'auteur commercial

Une nouvelle génération de réalisateurs a réussi à allier vision artistique et succès commercial, créant des œuvres qui plaisent tant à la critique qu'au grand public.

### 3. La diversification des plateformes

L'arrivée de nouvelles plateformes de diffusion a permis aux films québécois de toucher un public plus large, notamment :

- Les services de streaming locaux
- Les projections en plein air
- Les festivals virtuels

## Impact économique

L'industrie cinématographique québécoise a généré plus de **450 millions de dollars** en 2024, soit une augmentation significative par rapport aux années précédentes. Cette croissance s'explique par :

1. **Investissements gouvernementaux** accrus dans la production locale
2. **Partenariats internationaux** qui ont permis des coproductions ambitieuses
3. **Innovation technologique** qui a réduit les coûts de production

## Perspectives pour 2025

L'avenir s'annonce prometteur pour le cinéma québécois avec :

- 35 productions en développement
- De nouveaux talents émergents
- Des investissements record dans les infrastructures

Le cinéma québécois continue de se réinventer tout en préservant son identité unique, promettant des années encore plus excitantes à venir.
    `,
    date: "2024-12-15",
    author: "Équipe Box-Office Québec",
    readTime: "5 min",
    category: "Analyse"
  }

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

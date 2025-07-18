// API utility to handle different development environments

const getApiBaseUrl = () => {
  // Check if we're in development and which port we're on
  if (import.meta.env.DEV) {
    const currentPort = window.location.port;
    
    // If we're on Vite dev server (5173/5174), we need to proxy to Netlify dev
    if (currentPort === '5173' || currentPort === '5174') {
      // Check if Netlify dev is running on 8888
      return 'http://localhost:8888';
    }
    
    // If we're already on Netlify dev (8888), use current origin
    if (currentPort === '8888') {
      return window.location.origin;
    }
  }
  
  // Production or default case
  return window.location.origin;
};

export const apiCall = async (endpoint, options = {}) => {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/.netlify/functions/${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`API call failed for ${endpoint}:`, error);
    throw error;
  }
};

// Specific API functions
export const getBoxOfficeData = (period = 'weekend', limit = 10) => {
  return apiCall(`getBoxOfficeData?period=${period}&limit=${limit}`);
};

export const getMovieStats = (type = 'summary') => {
  return apiCall(`getMovieStats?type=${type}`);
};

export const getDirectorStats = (type = 'top_grossing') => {
  return apiCall(`getDirectorStats?type=${type}`);
};

export const getWeekendInfo = (weekendId = null) => {
  const query = weekendId ? `?weekendId=${weekendId}` : '';
  return apiCall(`getWeekendInfo${query}`);
};

export const testDatabase = () => {
  return apiCall('testDatabase');
};

export const getMovieDetails = (movieId) => {
  return apiCall(`getMovieDetails?movieId=${movieId}`);
};

export const getPreviousWeekend = (currentWeekendId) => {
  return apiCall(`getPreviousWeekend?currentWeekendId=${currentWeekendId}`);
};

export const getWeekCounts = (weekendId) => {
  return apiCall(`getWeekCounts?weekendId=${weekendId}`);
};

export const getWeekendBoxOffice = (weekendId = null) => {
  const params = weekendId ? `?weekendId=${weekendId}` : '';
  return apiCall(`getWeekendBoxOffice${params}`);
};

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { APIProvider, Map, Marker, useMap } from '@vis.gl/react-google-maps';
import './App.css';

const API_URL = 'http://localhost:5000/api/parse-prompt';

const SAMPLE_PROMPTS = [
  'mm Malabe idan Pettah yanawa, route eke thiyana pizza places monada?',
  'Colombo Fort idan Kandy yanakota coffee shops hoyala denna',
  'Galle idan Matara route eke fuel stations monada?',
];

const DEFAULT_CENTER = { lat: 7.4675, lng: 80.6234 };

function formatRouteDistance(distanceInMeters) {
  const distance = Number(distanceInMeters);

  if (!Number.isFinite(distance)) {
    return 'Near route';
  }

  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)} km`;
  }

  return `${Math.round(distance)} m`;
}

function formatRating(place) {
  const rating = Number(place.rating);
  const reviews = Number(place.user_ratings_total);

  if (!Number.isFinite(rating) || rating <= 0) {
    return 'No rating yet';
  }

  return `${rating.toFixed(1)} rating${
    Number.isFinite(reviews) && reviews > 0 ? `, ${reviews.toLocaleString()} reviews` : ''
  }`;
}

function getPlacePosition(place) {
  const lat = Number.parseFloat(place?.lat);
  const lng = Number.parseFloat(place?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function RenderPolyline({ encodedPath }) {
  const map = useMap();

  useEffect(() => {
    const maps = window.google?.maps;

    if (!map || !encodedPath || !maps?.geometry?.encoding) {
      return undefined;
    }

    try {
      const decodedPath = maps.geometry.encoding.decodePath(encodedPath);
      const polyline = new maps.Polyline({
        path: decodedPath,
        geodesic: true,
        strokeColor: '#1d6f68',
        strokeOpacity: 0.92,
        strokeWeight: 5,
      });

      polyline.setMap(map);

      const bounds = new maps.LatLngBounds();
      decodedPath.forEach((latLng) => bounds.extend(latLng));
      map.fitBounds(bounds, 72);

      return () => polyline.setMap(null);
    } catch (err) {
      console.error('Polyline decoding error:', err);
      return undefined;
    }
  }, [map, encodedPath]);

  return null;
}

function MapFocus({ selectedPlace }) {
  const map = useMap();

  useEffect(() => {
    const position = getPlacePosition(selectedPlace);

    if (!map || !position) {
      return;
    }

    map.panTo(position);
    map.setZoom(Math.max(map.getZoom() || 14, 15));
  }, [map, selectedPlace]);

  return null;
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseData, setResponseData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedPlaceIndex, setSelectedPlaceIndex] = useState(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const places = responseData?.places_along_route ?? [];
  const selectedPlace =
    selectedPlaceIndex === null ? null : places[selectedPlaceIndex] ?? null;
  const routeMeta = responseData?.meta;

  const routeStats = useMemo(
    () => [
      { label: 'Distance', value: routeMeta?.distance ?? 'Awaiting route' },
      { label: 'Duration', value: routeMeta?.duration ?? 'Awaiting route' },
      { label: 'Matches', value: responseData ? places.length : '0' },
    ],
    [places.length, responseData, routeMeta?.distance, routeMeta?.duration],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!prompt.trim()) {
      setErrorMsg('Enter a route request to begin.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSelectedPlaceIndex(null);

    try {
      const res = await axios.post(API_URL, { prompt: prompt.trim() });

      if (res.data.success) {
        setResponseData(res.data);
      } else {
        setErrorMsg(res.data.error || 'The route could not be analyzed.');
      }
    } catch (error) {
      console.error('Frontend error:', error);
      const backendError =
        error.response?.data?.error ||
        'Could not connect to the navigation pipeline. Please try again.';
      setErrorMsg(backendError);
    } finally {
      setLoading(false);
    }
  };

  if (!apiKey) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <p className="eyebrow">Configuration needed</p>
          <h1>Google Maps key is missing</h1>
          <p>
            Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to{' '}
            <code>frontend/.env</code> and restart the frontend dev server.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="control-panel" aria-label="Route search controls">
        <header className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            GP
          </div>
          <div>
            <p className="eyebrow">Spatial route assistant</p>
            <h1>GeoPrompt Navigator</h1>
          </div>
        </header>

        <section className="panel-section composer-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ask in Singlish or Sinhala</p>
              <h2>Plan a smarter stop</h2>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="prompt-form">
            <label htmlFor="route-prompt">Travel prompt</label>
            <textarea
              id="route-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Example: mm Malabe idan Pettah yanawa, route eke thiyana pizza places monada?"
              rows={5}
            />

            <div className="prompt-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={!prompt || loading}
                onClick={() => setPrompt('')}
              >
                Clear
              </button>
              <button type="submit" className="primary-button" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Analyzing
                  </>
                ) : (
                  'Navigate route'
                )}
              </button>
            </div>
          </form>

          <div className="sample-prompts" aria-label="Sample prompts">
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                type="button"
                key={sample}
                onClick={() => setPrompt(sample)}
                disabled={loading}
              >
                {sample}
              </button>
            ))}
          </div>
        </section>

        {errorMsg && (
          <div className="alert" role="alert">
            <strong>Request failed</strong>
            <span>{errorMsg}</span>
          </div>
        )}

        <section className="route-stats" aria-label="Route summary">
          {routeStats.map((stat) => (
            <div key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </section>

        <section className="panel-section results-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recommendations</p>
              <h2>{responseData ? 'Route findings' : 'Ready when you are'}</h2>
            </div>
          </div>

          {responseData ? (
            <>
              <div className="ai-panel">
                <span className="panel-kicker">AI advice</span>
                <p>{responseData.ai_analysis}</p>
              </div>

              <div className="places-list">
                {places.length > 0 ? (
                  places.map((place, index) => (
                    <button
                      type="button"
                      className={`place-row ${
                        selectedPlaceIndex === index ? 'is-selected' : ''
                      }`}
                      key={`${place.name}-${index}`}
                      onClick={() => setSelectedPlaceIndex(index)}
                    >
                      <span className="place-rank">{index + 1}</span>
                      <span className="place-content">
                        <strong>{place.name}</strong>
                        <span>{place.formatted_address || 'Address unavailable'}</span>
                        <span className="place-meta">
                          {formatRating(place)} / {formatRouteDistance(place.distance_from_route)} from route
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>No places found on this route</strong>
                    <span>Try a broader place type or more specific locations.</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <strong>Describe where you are going</strong>
              <span>
                The app will draw the route, surface nearby places, and summarize the best stop.
              </span>
            </div>
          )}
        </section>
      </aside>

      <main className="map-stage" aria-label="Interactive route map">
        <div className="map-topbar">
          <div>
            <span className="map-status-dot" aria-hidden="true" />
            <span>{responseData ? 'Route plotted' : 'Map standby'}</span>
          </div>
          <strong>
            {routeMeta
              ? `${routeMeta.origin} to ${routeMeta.destination}`
              : 'Sri Lanka route workspace'}
          </strong>
        </div>

        <APIProvider apiKey={apiKey} libraries={['geometry']}>
          <Map
            style={{ width: '100%', height: '100%' }}
            defaultCenter={DEFAULT_CENTER}
            defaultZoom={12}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            {routeMeta?.polyline && <RenderPolyline encodedPath={routeMeta.polyline} />}
            <MapFocus selectedPlace={selectedPlace} />

            {places.map((place, index) => {
              const position = getPlacePosition(place);

              if (!position) {
                return null;
              }

              return <Marker key={`${place.name}-marker-${index}`} position={position} title={place.name} />;
            })}
          </Map>
        </APIProvider>

        {!responseData && (
          <div className="map-hint">
            <strong>Start with a route prompt</strong>
            <span>Results will appear here with the route polyline and place markers.</span>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

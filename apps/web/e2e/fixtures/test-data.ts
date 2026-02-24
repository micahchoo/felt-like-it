/** Small GeoJSON FeatureCollection for import tests */
export const SF_LANDMARKS: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Golden Gate Bridge' },
      geometry: { type: 'Point', coordinates: [-122.4783, 37.8199] },
    },
    {
      type: 'Feature',
      properties: { name: 'Alcatraz Island' },
      geometry: { type: 'Point', coordinates: [-122.4229, 37.8267] },
    },
    {
      type: 'Feature',
      properties: { name: 'Coit Tower' },
      geometry: { type: 'Point', coordinates: [-122.4058, 37.8024] },
    },
  ],
};

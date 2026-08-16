/**
 * The spatial vocabulary this demo exposes to natural language.
 *
 * A catalog is the contract between what a user can say and what the
 * application will let them touch. Nothing outside this file can be named in
 * a command, and every field id here is a real property on the live data.
 */

import { OPERATION } from '../src/core/index.js';

const QUERY_CAPABILITIES = [
  OPERATION.LAYER_VISIBILITY,
  OPERATION.QUERY_FILTER,
  OPERATION.QUERY_SELECT,
  OPERATION.QUERY_SPATIAL_SELECT,
  OPERATION.QUERY_COUNT,
  OPERATION.QUERY_CLEAR,
];

export const CATALOG = {
  version: 'usgs-demo-2026.08',
  layers: [
    {
      id: 'earthquakes',
      label: 'Earthquakes',
      aliases: ['quakes', 'quake', 'earthquake', 'seismic events', 'events', 'tremors'],
      description: 'USGS magnitude 2.5+ events, past 30 days.',
      fields: [
        {
          id: 'mag',
          label: 'Magnitude',
          aliases: ['magnitude', 'strength', 'size'],
          type: 'number',
        },
        {
          id: 'depth_km',
          label: 'Depth',
          aliases: ['depth'],
          type: 'number',
          unit: 'kilometer',
        },
        {
          id: 'place',
          label: 'Place',
          aliases: ['location', 'region', 'area name'],
          type: 'string',
        },
        {
          id: 'alert',
          label: 'Alert level',
          aliases: ['alert', 'pager alert'],
          type: 'string',
        },
        {
          id: 'tsunami',
          label: 'Tsunami flag',
          aliases: ['tsunami'],
          type: 'boolean',
        },
        {
          id: 'sig',
          label: 'Significance',
          aliases: ['significance'],
          type: 'number',
        },
        {
          id: 'felt',
          label: 'Felt reports',
          aliases: ['felt reports', 'reports'],
          type: 'number',
        },
        {
          id: 'magType',
          label: 'Magnitude type',
          aliases: ['magnitude type'],
          type: 'string',
        },
      ],
      capabilities: [
        ...QUERY_CAPABILITIES,
        OPERATION.ANALYSIS_BUFFER,
        OPERATION.DATA_EXPORT,
      ],
    },
    {
      id: 'cities',
      label: 'Cities',
      aliases: ['city', 'population centres', 'population centers', 'urban areas'],
      description: 'Bundled reference layer of major cities in seismic regions.',
      fields: [
        {
          id: 'name',
          label: 'Name',
          aliases: ['city name'],
          type: 'string',
        },
        {
          id: 'country',
          label: 'Country',
          aliases: ['nation'],
          type: 'string',
        },
        {
          id: 'population',
          label: 'Population',
          aliases: ['people', 'residents'],
          type: 'number',
        },
      ],
      capabilities: [...QUERY_CAPABILITIES, OPERATION.DATA_EXPORT],
    },
  ],
};

/**
 * Commands offered as one-click chips.
 *
 * The chip shows a short label so the whole set is scannable at a glance;
 * clicking one puts the full sentence in the input, which is also how a
 * newcomer learns the phrasing the compiler accepts.
 */
export const EXAMPLES = [
  { label: 'go to India', command: 'go to India and zoom in' },
  { label: 'go to Delhi', command: 'go to Delhi' },
  { label: 'magnitude > 5', command: 'show earthquakes where magnitude is greater than 5' },
  { label: 'alert is green', command: 'filter earthquakes where alert is green' },
  { label: 'place contains japan', command: 'show earthquakes where place contains japan' },
  { label: 'strong and shallow', command: 'filter earthquakes where magnitude is above 5 and depth is less than 70' },
  { label: 'count M6+', command: 'count earthquakes where magnitude is at least 6' },
  { label: 'near a city', command: 'select earthquakes within 300 kilometers of cities' },
  { label: 'buffer 50 km', command: 'buffer selection by 50 kilometers' },
  { label: 'export selection', command: 'export selection as geojson' },
  { label: 'clear filters', command: 'clear filters' },
  { label: 'hide cities', command: 'hide cities' },
];

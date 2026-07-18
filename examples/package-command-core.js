import {
  CommandPolicy,
  OPERATION,
  createFunctionAdapter,
  createVoiceGISCore,
} from 'voicegis/core';

const applicationState = {
  visibleLayers: new Set(),
  filters: new Map(),
  selection: [{ id: 'parcel-17' }, { id: 'parcel-41' }],
  exports: [],
};

const adapter = createFunctionAdapter({
  [OPERATION.LAYER_VISIBILITY]: ({ target, args }) => {
    if (args.visible) applicationState.visibleLayers.add(target.layerId);
    else applicationState.visibleLayers.delete(target.layerId);
    return { visible: args.visible };
  },

  [OPERATION.QUERY_FILTER]: ({ target, args }) => {
    applicationState.filters.set(target.layerId, args.predicate);
    return { predicate: args.predicate };
  },

  [OPERATION.ANALYSIS_BUFFER]: ({ target, args }) => {
    return {
      source: target,
      distance: args.distance,
      featureCount: applicationState.selection.length,
    };
  },

  [OPERATION.DATA_EXPORT]: ({ target, args }) => {
    const artifact = {
      id: `export-${applicationState.exports.length + 1}`,
      target,
      format: args.format,
    };
    applicationState.exports.push(artifact);
    return artifact;
  },
});

const gis = createVoiceGISCore({
  catalog: {
    version: 'example-1',
    layers: [{
      id: 'parcels',
      label: 'Land parcels',
      aliases: ['plots'],
      fields: [
        {
          id: 'area_ha',
          label: 'Area',
          aliases: ['size'],
          type: 'number',
          unit: 'hectare',
        },
        {
          id: 'zoning',
          label: 'Zoning',
          type: 'string',
        },
      ],
      capabilities: [
        OPERATION.LAYER_VISIBILITY,
        OPERATION.QUERY_FILTER,
        OPERATION.ANALYSIS_BUFFER,
        OPERATION.DATA_EXPORT,
      ],
    }],
  },
  policy: new CommandPolicy({
    permissions: ['view', 'query', 'analysis', 'export'],
    confirm: [OPERATION.ANALYSIS_BUFFER, OPERATION.DATA_EXPORT],
  }),
  adapter,
});

async function run(command) {
  const plan = await gis.compile(command);
  console.log('\nCommand:', command);
  console.log('Plan:', JSON.stringify(plan, null, 2));

  const receipt = await gis.execute(plan, {
    // Replace this callback with a real dialog in a user-facing application.
    confirm: async (operation) => {
      console.log(`Confirmed: ${operation.type}`);
      return true;
    },
  });
  console.log('Receipt:', JSON.stringify(receipt, null, 2));
}

await run('show plots where size is greater than 2 hectares');
await run(
  'buffer selected features by 250 meters and export selected features as geojson'
);

import { router } from './init.js';
import { mapsRouter } from './routers/maps.js';
import { layersRouter } from './routers/layers.js';
import { featuresRouter } from './routers/features.js';
import { sharesRouter } from './routers/shares.js';
import { eventsRouter } from './routers/events.js';
import { commentsRouter } from './routers/comments.js';
import { collaboratorsRouter } from './routers/collaborators.js';
import { geoprocessingRouter } from './routers/geoprocessing.js';

export const appRouter = router({
  maps: mapsRouter,
  layers: layersRouter,
  features: featuresRouter,
  shares: sharesRouter,
  events: eventsRouter,
  comments: commentsRouter,
  collaborators: collaboratorsRouter,
  geoprocessing: geoprocessingRouter,
});

export type AppRouter = typeof appRouter;

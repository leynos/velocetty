import configureStoreForDevelopment from './configure-store.dev';
import configureStoreForProduction from './configure-store.prod';

/** Builds the Redux store, selecting the production or development configuration by `NODE_ENV`. */
const configureStore = () => {
  if (process.env.NODE_ENV === 'production') {
    return configureStoreForProduction();
  }

  return configureStoreForDevelopment();
};
export default configureStore;

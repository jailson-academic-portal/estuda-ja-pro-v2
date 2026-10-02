import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { CustomErrorBoundary } from "./components/CustomErrorBoundary";

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: CustomErrorBoundary,
  });

  return router;
};

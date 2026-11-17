import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Inside the planner, changing tabs never jumps the page back to the top: the plan
    // keeps its scroll and the side panel remembers each tab's (see AppShell).
    scrollRestoration: ({ location }) =>
      location.pathname === "/" && !(location.search as { plan?: 1 }).plan,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

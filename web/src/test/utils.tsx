import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { MemoryRouter } from "react-router-dom";
import App from "@/App";
import { TooltipProvider } from "@/components/ui/controls";
import { resetMock } from "@/mocks/router";

export function renderApp(route = "/") {
  resetMock();
  window.localStorage.clear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <TooltipProvider>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>,
  );
}

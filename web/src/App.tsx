import { Route, Routes } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import OverviewPage from "@/pages/Overview";
import ActivityPage from "@/pages/Activity";
import JobsPage from "@/pages/Jobs";
import ApplicationsPage from "@/pages/Applications";
import QuestionsPage from "@/pages/Questions";
import LoopsPage from "@/pages/Loops";
import LoopDetailPage from "@/pages/LoopDetail";
import SettingsPage from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewPage />} />
        <Route path="loops" element={<LoopsPage />} />
        <Route path="loops/:id" element={<LoopDetailPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

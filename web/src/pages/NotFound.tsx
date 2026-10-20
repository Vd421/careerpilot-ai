import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="That page does not exist"
      hint="The link may be old, or the page moved."
      action={
        <Link to="/">
          <Button variant="primary">Back to overview</Button>
        </Link>
      }
      className="py-32"
    />
  );
}

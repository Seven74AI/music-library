import { Link } from "react-router";
import { Button } from "#app/components/ui/button.tsx";

export function MarketingHome() {
  return (
    <main className="flex flex-col items-center justify-center py-16 text-center">
      <div className="group grid leading-snug">
        <span className="text-4xl font-light md:text-5xl">epic</span>
        <span className="text-4xl font-bold md:text-5xl">music</span>
      </div>
      <p className="text-muted-foreground mt-6 max-w-md text-lg">Your personal music library</p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <Button asChild size="lg">
          <Link to="/login">Log in</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/signup">Sign up</Link>
        </Button>
      </div>
    </main>
  );
}

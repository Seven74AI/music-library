import { data } from "react-router";

export function loader() {
  return data({});
}

export default function AboutRoute() {
  return <div>About page</div>;
}

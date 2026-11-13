import React from "react";

export function DangerousComponent() {
  return <div dangerouslySetInnerHTML={{ __html: "<script>alert(1)</script>" }} />;
}

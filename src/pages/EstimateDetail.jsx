import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function EstimateDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const navigate = useNavigate();

  useEffect(() => {
    const url = id
      ? createPageUrl(`DocumentDetail?id=${id}`)
      : createPageUrl("DocumentDetail?type=estimate");
    navigate(url, { replace: true });
  }, [id, navigate]);

  return null;
}

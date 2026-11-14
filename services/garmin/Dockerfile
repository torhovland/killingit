# Garmin sidecar image for Cloud Run (ADR 0003 amendment).
#
# The service is deployed as a private Cloud Run service: the API calls it with
# an OIDC identity token and only the API's runtime service account holds
# roles/run.invoker. Cloud Run injects PORT=8080.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Only the runtime modules: `app.py` is the route layer and the rest are its
# concerns (ADR 0058). The tests, the shared test stubs and the contract
# fixtures stay out of the image.
COPY app.py auth.py activities.py body.py daily.py errors.py values.py ./

# Run unprivileged. The token cache lives under /tmp, which is writable.
RUN useradd --create-home --uid 10001 sidecar
USER sidecar

EXPOSE 8080

CMD ["python", "app.py"]

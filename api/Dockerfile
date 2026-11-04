FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY TodoBoard.Api/TodoBoard.Api.csproj TodoBoard.Api/
RUN dotnet restore TodoBoard.Api/TodoBoard.Api.csproj
COPY TodoBoard.Api/ TodoBoard.Api/
RUN dotnet publish TodoBoard.Api/TodoBoard.Api.csproj -c Release --no-restore -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "TodoBoard.Api.dll"]

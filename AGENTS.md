A proxy for tokscale (C:\Users\adityasharma\Projects\oss\tokscale-proxy) so that we can capture the tokscale submit output and collate it across different machines and submit a combined report to tokscale.

I want to run it like `tk-proxy --capture -- tokscale submit`  and it should capture the output of tokscale submit in a json file. 

then tk-proxy --combine -i <file 1> <file 2> <etc> -o output.json to combine the output of multiple tokscale submits into a single report.

then tk-proxy --submit -i output.json to submit the combined report to tokscale. our submission can use tokscale binary or we can read the source code of tokscale and submit the report using the same logic and API endpoint.
